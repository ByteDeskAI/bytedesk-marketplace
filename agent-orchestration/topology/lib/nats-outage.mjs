// TM-276 / ADR-0031: an unreachable configured NATS is reported to the repository lead, not hidden.
//
// openNatsTransport records the outage in transport.json when it falls back to the managed local
// server, and closes it when an open needs no fallback. This tick, run by each repository's
// supervisor, turns that record into at most two durable standing messages to the lead per outage:
// one when it starts, one when it ends (recovered, or retired once nothing on the host has fallen back
// from it for OUTAGE_RETIRE_MS — the operator removed the dead URL). Message ids derive from the outage's `since`, so a
// restarted supervisor or a retried send never mails twice.
import { createHash } from 'node:crypto';
import { hostname, homedir } from 'node:os';
import net from 'node:net';
import { canonicalRepoId, repoKey } from './repoid.mjs';
import { OUTAGE_RETIRE_MS, discardLiveTransports, holdsFallbackFrom, readTransportState, retireStaleOutage, touchFallback, writeTransportState } from './orch-transport.mjs';
import { readLeadRegistration } from './lead.mjs';
import { readStandingMessage, sendStandingMessage } from './standing-mailbox.mjs';

// A server that accepts TCP but refuses NATS (auth, TLS, not NATS at all) passes canReach on every
// tick, and each pass force-closes every cached transport. So re-dials back off per outage: 30 s,
// doubling to 15 min. ponytail: in-process; a restarted supervisor starts the ladder again.
const REDIAL_FIRST_MS = 30_000, REDIAL_MAX_MS = 15 * 60_000;
const redials = new Map();

// TM-309: v2 because the envelope now names its sender; a pre-TM-309 record under the v1 id is
// permanently held (source_identity_required) and an envelope change under the same id is refused.
const messageId = (kind, key, since) => createHash('sha256').update(`nats-${kind}:v2:${key}:${since}`).digest('hex').slice(0, 32);

/** TM-309: the sender these notices carry. Same-repository mail from a named sender is admitted;
 * an envelope with no `from`/`fromProject` is held forever as source_identity_required. */
export const SUPERVISOR_SENDER = 'ao-supervisor';

/** TCP reachability of a nats:// URL or a unix socket path. ponytail: first server of a list only. */
export function canReach(url, timeoutMs = 1000) {
  return new Promise((resolve) => {
    let target;
    try {
      if (String(url).startsWith('/')) target = { path: url };
      else { const parsed = new URL(String(url).split(',')[0]); target = { host: parsed.hostname, port: Number(parsed.port) || 4222 }; }
    } catch { resolve(false); return; }
    const socket = net.connect(target, () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(timeoutMs, () => { socket.destroy(); resolve(false); });
  });
}

/** Returns null when there is nothing to say, else what was sent or why it was not. Never throws for a missing lead. */
export async function natsOutageTick({ consumer, env = process.env, home = homedir(), deliver = sendStandingMessage, lead = readLeadRegistration, reachable = canReach,
  discard = discardLiveTransports, now = Date.now, retireAfterMs = Number(env.AO_NATS_OUTAGE_RETIRE_MS) || OUTAGE_RETIRE_MS, holds = holdsFallbackFrom }) {
  let state = await readTransportState(env, home, { retireAfterMs: Infinity });
  if (!state?.outage?.since) return null;
  // A connection this supervisor still holds on the fallback is a fallback in use: keep the outage live.
  // touchFallback is the same refresh every holder's transport heartbeat runs (TM-295).
  if (!state.outage.recovered_at && holds(state.outage) && await touchFallback(env, home, state.outage, { now: now(), retireAfterMs })) {
    state = await readTransportState(env, home, { retireAfterMs: Infinity });
  }
  const checked = retireStaleOutage(state, { now: now(), retireAfterMs });
  if (checked !== state) await writeTransportState(env, home, checked);
  state = checked;
  const outage = state.outage;
  const key = repoKey((await canonicalRepoId(consumer)).id);
  const outageId = messageId('outage', key, outage.since), recoveryId = messageId('recovered', key, outage.since);
  // TM-309: a record is not a delivery. Only `delivered` silences the tick; a held one is reported
  // with its reason every tick, and resumeStandingMessages (same supervisor tick) retries it.
  const record = async (id) => readStandingMessage({ id, env, home }).catch(() => null);
  const delivered = async (id) => (await record(id))?.status === 'delivered';
  let probed = false;
  const redialKey = `${outage.since}|${outage.url}`;
  const redial = redials.get(redialKey);
  if (outage.recovered_at) redials.delete(redialKey);
  // TM-308: a port conflict answers TCP by definition (something else holds it); the next managed
  // open that succeeds on that port is what closes it, so there is nothing to probe.
  else if (!outage.conflict && (!redial || now() >= redial.at) && await reachable(outage.url)) {
    // The configured NATS answers TCP again. Drop the cached local connection so the next open dials
    // the configured one through the real connect path, which is what closes the outage.
    await discard();
    probed = true;
    const wait = redial ? Math.min(redial.wait * 2, REDIAL_MAX_MS) : REDIAL_FIRST_MS;
    redials.set(redialKey, { at: now() + wait, wait });
  }
  const kind = outage.retired ? 'retired' : outage.recovered_at ? 'recovered' : 'outage';
  const id = kind === 'outage' ? outageId : recoveryId; // recovered and retired share one closing id
  const existing = await record(id);
  if (existing?.status === 'delivered') return probed ? { kind, status: 'already-sent', probed } : null;
  if (existing) return { kind, status: existing.status, reason: existing.reason ?? null, message_id: id, ...(probed ? { probed } : {}) };
  // A recovery or retirement is only news to a lead that was told about the outage.
  if (kind !== 'outage' && !(await delivered(outageId))) return null;
  const registration = await lead({ consumer, env, home }).catch(() => null);
  const leadId = registration?.record?.agent_id ?? null;
  if (!leadId) return { kind, status: 'skipped', reason: 'no lead is registered for this repository' };
  const where = `${outage.url} (${outage.source})`;
  const body = kind === 'outage' && outage.conflict ? [
    `NATS PORT CONFLICT on ${hostname()}: ao's managed NATS port ${outage.conflict.port} is held by another process, so ao's NATS is not running here.`,
    `Error: ${outage.error}`,
    `Since: ${outage.since}`,
    `ao does not move to another port (ADR-0032). Stop the holder, or set a different nats.port in the ao user config and run \`agent-orchestration services ensure\`. You will get one more message when it is resolved.`,
  ] : kind === 'outage' ? [
    `NATS OUTAGE on ${hostname()}: the configured NATS ${where} is unreachable.`,
    `Error: ${outage.error}`,
    `Since: ${outage.since}`,
    `Fallback: ao is working on the managed local NATS ${state.url ?? 'on this host'}. Work on this host continues, but agents on other machines that use ${outage.url} do not see this host's mail, claims or presence until it is back.`,
    `Fix the server at ${outage.url}, or remove ${outage.source} from this host's environment. You will get one more message when it answers again.`,
  ] : kind === 'retired' ? [
    `NATS OUTAGE RETIRED on ${hostname()}: nothing on this host has fallen back from ${where} since ${outage.last_fallback_at ?? outage.since}, so ao no longer treats it as configured.`,
    `It was not proven reachable. ao is on ${state.url} (${state.source}). The outage began ${outage.since}: ${outage.error}`,
  ] : [
    `NATS RECOVERED on ${hostname()}: ${where} answers again (since ${outage.recovered_at}); ao is ${state.source === outage.source ? 'back on it' : `now on ${state.url} (${state.source})`}.`,
    `The outage began ${outage.since}: ${outage.error}`,
  ];
  return deliver({ id, consumer, fromProject: consumer, from: SUPERVISOR_SENDER, to: leadId, subject: `NATS ${kind === 'outage' && outage.conflict ? 'port conflict' : kind}: ${outage.url}`,
    body: body.join('\n'), provenance: { source: 'ao-topology supervise' } }, { env, home })
    .then(sent => ({ kind, status: sent?.status ?? 'failed', ...(sent?.status === 'delivered' ? {} : { reason: sent?.reason ?? null }), to: leadId, message_id: id }))
    .catch(error => ({ kind, status: 'failed', to: leadId, reason: error?.code ?? String(error) }));
}
