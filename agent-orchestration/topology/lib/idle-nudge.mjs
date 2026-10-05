// TM-408. AN IDLE AGENT PULLS ITS NEXT ASSIGNMENT; IT NEVER ASKS THE OPERATOR "WHAT NEXT?".
//
// The prompts state the rule (prompts/common.md, prompts/lead.md, the generated Protocol section,
// the role packs). This is the supervisor's half: when the census sees a standing agent idle and
// dispatchable, ring its pane with the pull it should make — a worker asks its repository lead
// through the standing mailbox, a lead takes the next ready task from its own board. The bell is
// the same safe one probes use (`wakeForProbe` -> `checkBellSafe`): alive, binding intact, composer
// empty, no attention or failure screen. A draft in the box or a tool prompt on screen types NOTHING.
//
// WHEN, and the guard the census cannot give us. The census cannot tell "finished, ready for more"
// from "stopped to ask a human" (census.mjs, the `dispatchable` comment): both read needs-input for
// one tick and idle afterwards. So the guard is TIME: an agent is rung only after `min_idle_ms`
// (default 10 min) of continuous quiet counted from the end of its work (`needsInputAt`, else
// `since`), and a lead — often the operator's own session, whose unanswered question is the likeliest
// "still ask" — only after `lead_min_idle_ms` (default 30 min). A question nobody answered in that
// time gets at most one nudge, through the safe bell.
//
// HOW OFTEN. Once per idle period (the row's `since`), and a ring is itself a turn that starts a new
// period, so repeats are CHANGE-GATED: after a ring, the agent is not rung again until the ready set
// on the board changes (`boardFingerprint`) or new standing mail arrives for it (`mailMark`). An
// exponential backoff (`backoff_ms`, doubling per ring up to `max_backoff_ms`) is the floor under
// that; new mail resets it. A refused ring is retried no sooner than `retry_ms`, and the same
// refusal is reported once per idle period.
//
// SCOPE. Standing agents only. A run agent belongs to its conductor; the reviewer is read-only and
// cannot run the mailbox command.
//
// MEMORY survives a restart: `createIdleNudge({ path })` loads and saves it atomically under the
// supervision state dir, so a crash-looping supervisor does not ring every idle agent on every
// start. A missing or corrupt file reads as empty.
//
// Config, in any AO layer: the `idle_nudge` object. `enabled` defaults to true, as the operator
// asked; false is the off switch.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { adapterForPane } from './census.mjs';
import { loadConfig } from './config.mjs';
import { composerFormat, ringCapability, wakeForProbe } from './delivery.mjs';
import { tmuxFailureTrigger } from './launch.mjs';
import { readLeadRegistration } from './lead.mjs';
import { standingMailboxRoot } from './standing-mailbox.mjs';
import { tmux as defaultTmux, withServer } from './tmux.mjs';
import { readJson, shellQuote, writeJson } from './util.mjs';

const MINUTE = 60_000;
export const IDLE_NUDGE_DEFAULTS = Object.freeze({
  enabled: true, min_idle_ms: 10 * MINUTE, lead_min_idle_ms: 30 * MINUTE,
  backoff_ms: 30 * MINUTE, max_backoff_ms: 8 * 60 * MINUTE, retry_ms: MINUTE,
});

export function idleNudgeConfig(config) {
  const raw = config?.idle_nudge ?? {};
  const ms = (key) => (Number.isFinite(raw[key]) && raw[key] >= 0 ? raw[key] : IDLE_NUDGE_DEFAULTS[key]);
  return { enabled: raw.enabled !== false, min_idle_ms: ms('min_idle_ms'), lead_min_idle_ms: ms('lead_min_idle_ms'),
    backoff_ms: ms('backoff_ms'), max_backoff_ms: ms('max_backoff_ms'), retry_ms: ms('retry_ms') };
}

const TAG = '[ao]';
const ASK_BODY = 'Finished my current work; what is my next assignment?';

/** The text rung into the pane. Pure, so the exact command an agent is told to run is testable. */
export function nudgeText({ consumer, agentId, leadId, isLead }) {
  if (isLead) {
    return `${TAG} You are idle. Do not ask the operator what is next: pick the next ready task with tm next `
      + '(also check ready-for-agent, blocked and stale in_progress) and assign or dispatch it yourself. '
      + 'If nothing is ready, report the board state once and stay idle.';
  }
  const repo = shellQuote(consumer);
  return `${TAG} You are idle. Do not ask the operator what is next. Ask your lead for your next assignment: `
    + `ao-topology mailbox send --consumer ${repo} --from ${shellQuote(agentId)} --to ${shellQuote(leadId)} `
    + `--subject next-assignment --body ${shellQuote(ASK_BODY)} `
    + `then wait on your inbox: ao-topology mailbox inbox --consumer ${repo} --agent ${shellQuote(agentId)}`;
}

/**
 * The ready set on the board, as one hash: every task file under the repository's task store that
 * carries `ready-for-agent` and is not finished, with its status. A plain read of the documented
 * on-disk store, not an import of task-management (the two plugins stay independent); null when
 * there is no store. Body edits and comments do not move it; a task becoming ready, leaving, or
 * changing status does.
 */
export async function boardFingerprint(consumer) {
  const dir = join(consumer, '.bytedesk', 'task-management', 'tasks');
  const names = await readdir(dir).catch(() => null);
  if (!names) return null;
  const hash = createHash('sha256');
  for (const name of names.filter((item) => item.endsWith('.md')).sort()) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => '');
    const head = text.split('\n---', 1)[0];
    const status = /^status:\s*"?([\w-]+)/m.exec(head)?.[1] ?? '';
    const labels = /^labels:(.*)$/m.exec(head)?.[1] ?? '';
    if (labels.includes('ready-for-agent') && !FINISHED.has(status)) hash.update(`${name}:${status}\n`);
  }
  return hash.digest('hex');
}
const FINISHED = new Set(['done', 'cancelled', 'wontfix']);

/**
 * How much standing mail has been addressed to this agent: count and newest creation time.
 * ponytail: reads every message record, and only for an agent that already passed the cheap gates;
 * index by recipient if the mailbox grows large enough for that to matter.
 */
export async function mailMark(agentId, { env = process.env, home = homedir() } = {}) {
  const dir = join(standingMailboxRoot({ env, home }), 'messages');
  const names = await readdir(dir).catch(() => null);
  if (!names) return null;
  let count = 0;
  let latest = '';
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    const record = await readFile(join(dir, name), 'utf8').then(JSON.parse).catch(() => null);
    if (record?.envelope?.to !== agentId) continue;
    count += 1;
    if (String(record.created_at ?? '') > latest) latest = String(record.created_at);
  }
  return `${count}:${latest}`;
}

export function createIdleNudge({ path = null } = {}) {
  return { memory: new Map(), path, loaded: !path };
}

async function loadState(state) {
  if (state.loaded) return;
  state.loaded = true;
  const doc = await readJson(state.path).catch(() => null);
  const agents = doc && typeof doc.agents === 'object' && !Array.isArray(doc.agents) ? doc.agents : {};
  for (const [id, value] of Object.entries(agents)) if (value && typeof value === 'object') state.memory.set(id, value);
}

async function saveState(state) {
  if (state.path) await writeJson(state.path, { version: 1, agents: Object.fromEntries(state.memory) }).catch(() => null);
}

async function ringOne(row, { consumer, leadId, isLead, panes, adapters, wake, tmux }) {
  if (!isLead && !leadId) return { rang: false, reason: 'no registered repository lead to ask' };
  const pane = panes.find((item) => item.paneId === row.binding.paneId && item.serverKey === row.binding.serverKey);
  const adapter = pane ? adapterForPane(adapters, pane) : null;
  if (ringCapability(adapter) !== 'supported') return { rang: false, reason: 'the provider has no measured safe composer' };
  const text = nudgeText({ consumer, agentId: row.agentId, leadId, isLead });
  const format = composerFormat(adapter, tmuxFailureTrigger(adapter));
  const result = await withServer(row.binding.serverKey, () => wake({ pane: row.binding.paneId, adapter, binding: row.binding, format, text, tmux }))
    .catch((error) => ({ rang: false, reason: error?.code ?? String(error) }));
  return result?.rang ? { rang: true } : { rang: false, reason: result?.reason ?? 'the composer cannot safely receive a pointer' };
}

/** The backoff floor after `rings` rings: backoff_ms, doubling per ring, capped at max_backoff_ms. */
function floorAfter(rings, settings) {
  return Math.min(settings.backoff_ms * Math.pow(2, Math.max(rings - 1, 0)), settings.max_backoff_ms);
}

/** Has this agent been quiet long enough? Counted from the end of its work, not from the last tick. */
function quietEnough(row, isLead, settings, now) {
  const quietSince = Date.parse(row.needsInputAt ?? row.since);
  const wanted = isLead ? settings.lead_min_idle_ms : settings.min_idle_ms;
  return Number.isFinite(quietSince) && now - quietSince >= wanted;
}

/**
 * One supervisor tick. `census` is the document the tick just took; `panes` the same listing.
 * Returns only the agents it rang or newly refused, so a quiet repository reports nothing.
 */
export async function idleNudgeTick(options, { census, panes, adapters, state = createIdleNudge(), now = Date.now(), tmux = defaultTmux, wake = wakeForProbe, config } = {}) {
  const { consumer, env = process.env, home = homedir(), pluginRoot = null } = options;
  if (census?.stale || !Array.isArray(panes) || !adapters) return [];
  const candidates = (census?.agents ?? []).filter((row) => row.dispatchable && row.state === 'idle' && !row.runId && row.repoRole !== 'reviewer' && row.binding?.paneId);
  if (!candidates.length) return [];
  const settings = idleNudgeConfig(config !== undefined ? config : (await loadConfig({ consumer, home, env, pluginRoot })).config);
  if (!settings.enabled) return [];
  await loadState(state);
  const registration = await (options.readLead ?? readLeadRegistration)({ consumer, env, home }).catch(() => null);
  const leadId = registration?.record?.agent_id ?? null;
  const fingerprintOf = options.boardFingerprint ?? (() => boardFingerprint(consumer));
  const mailOf = options.mailMark ?? ((agentId) => mailMark(agentId, { env, home }));
  let board;
  let changed = false;
  const outcomes = [];
  for (const row of candidates) {
    const prior = state.memory.get(row.agentId) ?? {};
    const isLead = row.agentId === leadId || row.repoRole === 'lead';
    const rang = prior.rangAt !== undefined;
    if (prior.rangSince === row.since) continue;
    if (prior.triedAt !== undefined && now - prior.triedAt < settings.retry_ms) continue;
    if (!quietEnough(row, isLead, settings, now)) continue;
    if (rang && now - prior.rangAt < floorAfter(prior.rings ?? 1, settings)) continue;
    if (board === undefined) board = await fingerprintOf();
    const mail = await mailOf(row.agentId);
    // Change gate: after a ring, nothing new on the board and no new mail means nothing to pull.
    if (rang && prior.board === board && prior.mail === mail) continue;
    const outcome = await ringOne(row, { consumer, leadId, isLead, panes, adapters, wake, tmux });
    changed = true;
    if (outcome.rang) {
      const rings = rang && prior.mail === mail ? (prior.rings ?? 1) + 1 : 1;
      state.memory.set(row.agentId, { rangAt: now, rangSince: row.since, board, mail, rings, triedAt: now });
      outcomes.push({ agent: row.agentId, lead: isLead, rang: true });
      continue;
    }
    const repeat = prior.refusedSince === row.since && prior.refusedReason === outcome.reason;
    state.memory.set(row.agentId, { ...prior, triedAt: now, refusedSince: row.since, refusedReason: outcome.reason });
    if (!repeat) outcomes.push({ agent: row.agentId, lead: isLead, ...outcome });
  }
  if (changed) await saveState(state);
  return outcomes;
}
