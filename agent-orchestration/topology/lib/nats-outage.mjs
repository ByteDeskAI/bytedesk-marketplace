// TM-276 / ADR-0031: an unreachable configured NATS is reported to the repository lead, not hidden.
//
// openNatsTransport records the outage in transport.json when it falls back to the managed local
// server, and closes it when an open needs no fallback. This tick, run by each repository's
// supervisor, turns that record into at most two durable standing messages to the lead per outage:
// one when it starts, one when it ends. Message ids derive from the outage's `since`, so a
// restarted supervisor or a retried send never mails twice.
import { createHash } from 'node:crypto';
import { hostname, homedir } from 'node:os';
import net from 'node:net';
import { canonicalRepoId, repoKey } from './repoid.mjs';
import { discardLiveTransports, readTransportState } from './orch-transport.mjs';
import { readLeadRegistration } from './lead.mjs';
import { readStandingMessage, sendStandingMessage } from './standing-mailbox.mjs';

// A server that accepts TCP but refuses NATS (auth, TLS, not NATS at all) passes canReach on every
// tick, and each pass force-closes every cached transport. So re-dials back off per outage: 30 s,
// doubling to 15 min. ponytail: in-process; a restarted supervisor starts the ladder again.
const REDIAL_FIRST_MS = 30_000, REDIAL_MAX_MS = 15 * 60_000;
const redials = new Map();

const messageId = (kind, key, since) => createHash('sha256').update(`nats-${kind}:${key}:${since}`).digest('hex').slice(0, 32);

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
  discard = discardLiveTransports, now = Date.now }) {
  const state = await readTransportState(env, home);
  const outage = state?.outage;
  if (!outage?.since) return null;
  const key = repoKey((await canonicalRepoId(consumer)).id);
  const outageId = messageId('outage', key, outage.since), recoveryId = messageId('recovered', key, outage.since);
  const sent = async (id) => Boolean(await readStandingMessage({ id, env, home }).catch(() => null));
  let probed = false;
  const redialKey = `${outage.since}|${outage.url}`;
  const redial = redials.get(redialKey);
  if (outage.recovered_at) redials.delete(redialKey);
  else if ((!redial || now() >= redial.at) && await reachable(outage.url)) {
    // The configured NATS answers TCP again. Drop the cached local connection so the next open dials
    // the configured one through the real connect path, which is what closes the outage.
    await discard();
    probed = true;
    const wait = redial ? Math.min(redial.wait * 2, REDIAL_MAX_MS) : REDIAL_FIRST_MS;
    redials.set(redialKey, { at: now() + wait, wait });
  }
  const kind = outage.recovered_at ? 'recovered' : 'outage';
  const id = kind === 'outage' ? outageId : recoveryId;
  if (await sent(id)) return probed ? { kind, status: 'already-sent', probed } : null;
  // A recovery is only news to a lead that was told about the outage.
  if (kind === 'recovered' && !(await sent(outageId))) return null;
  const registration = await lead({ consumer, env, home }).catch(() => null);
  const leadId = registration?.record?.agent_id ?? null;
  if (!leadId) return { kind, status: 'skipped', reason: 'no lead is registered for this repository' };
  const where = `${outage.url} (${outage.source})`;
  const body = kind === 'outage' ? [
    `NATS OUTAGE on ${hostname()}: the configured NATS ${where} is unreachable.`,
    `Error: ${outage.error}`,
    `Since: ${outage.since}`,
    `Fallback: ao is working on the managed local NATS ${state.url ?? 'on this host'}. Work on this host continues, but agents on other machines that use ${outage.url} do not see this host's mail, claims or presence until it is back.`,
    `Fix the server at ${outage.url}, or remove ${outage.source} from this host's environment. You will get one more message when it answers again.`,
  ] : [
    `NATS RECOVERED on ${hostname()}: ${where} answers again (since ${outage.recovered_at}); ao is ${state.source === outage.source ? 'back on it' : `now on ${state.url} (${state.source})`}.`,
    `The outage began ${outage.since}: ${outage.error}`,
  ];
  return deliver({ id, consumer, to: leadId, subject: kind === 'outage' ? `NATS outage: ${outage.url}` : `NATS recovered: ${outage.url}`,
    body: body.join('\n'), provenance: { source: 'ao-topology supervise' } }, { env, home })
    .then(record => ({ kind, status: record?.status ?? 'sent', to: leadId, message_id: id }))
    .catch(error => ({ kind, status: 'failed', to: leadId, reason: error?.code ?? String(error) }));
}
