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
// period, so repeats are CHANGE-GATED on the board alone: after a ring, the agent is not rung again
// until the ready set on the board changes (`boardFingerprint`). Mail deliberately does not reopen
// the gate: the nudge's own exchange (the worker asks, the lead answers "nothing ready") is mail, so
// a mail-gated nudge re-arms itself forever; arriving mail already rings its recipient (TM-419). An
// exponential backoff (`backoff_ms`, doubling per ring up to `max_backoff_ms`, reset after a quiet
// spell twice that long) is the floor under the gate. A refused ring is retried no sooner than
// `retry_ms`, and the same refusal is reported once per idle period. The cheap refusals (no lead
// registered, no safe composer) are decided before the board is read, and the board is read only
// for an agent that has already been rung once.
//
// SCOPE. Standing agents only. A run agent belongs to its conductor; the reviewer is read-only and
// cannot run the mailbox command.
//
// MEMORY survives a restart: `createIdleNudge({ path })` loads and saves it atomically under the
// supervision state dir, so a crash-looping supervisor does not ring every idle agent on every
// start. A missing or corrupt file reads as empty. An entry for an agent absent from the census
// and untried for 7 days is pruned.
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

const FINISHED = new Set(['done', 'cancelled', 'wontfix']);

/** The labels on a frontmatter `labels:` line, as exact tokens: a JSON array, or a bare list. */
function labelsOf(value) {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // fall through to a plain split
  }
  return String(value).split(/[\s,"'\[\]]+/).filter(Boolean);
}

/**
 * The ready set on the board: every task file under the repository's task store that carries the
 * exact label `ready-for-agent` and is not finished, with its status, hashed. A plain read of the
 * documented on-disk store, not an import of task-management (the two plugins stay independent).
 * Body edits and comments do not move it; a task becoming ready, leaving, or changing status does.
 *
 * Returns `{ fingerprint, problem }`. No store is `{ fingerprint: null, problem: null }`. Task files of
 * which NOT ONE carries a `status:` line mean the format changed under us: the fingerprint is null
 * and `problem` says so, so the change is visible instead of silently reading as "nothing ready".
 */
export async function readBoard(consumer) {
  const dir = join(consumer, '.bytedesk', 'task-management', 'tasks');
  const names = (await readdir(dir).catch(() => [])).filter((item) => item.endsWith('.md')).sort();
  if (!names.length) return { fingerprint: null, problem: null };
  const hash = createHash('sha256');
  let parsed = 0;
  for (const name of names) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => '');
    const head = text.split('\n---', 1)[0];
    const status = /^status:\s*"?([\w-]+)/m.exec(head)?.[1];
    if (status === undefined) continue;
    parsed += 1;
    const labels = labelsOf(/^labels:(.*)$/m.exec(head)?.[1] ?? '[]');
    if (labels.includes('ready-for-agent') && !FINISHED.has(status)) hash.update(`${name}:${status}\n`);
  }
  if (!parsed) return { fingerprint: null, problem: `none of ${names.length} task files under ${dir} has a status: line; the task store format may have changed` };
  return { fingerprint: hash.digest('hex'), problem: null };
}

/** The fingerprint alone, or null. */
export async function boardFingerprint(consumer) {
  return (await readBoard(consumer)).fingerprint;
}

export function createIdleNudge({ path = null } = {}) {
  return { memory: new Map(), path, loaded: !path, reported: new Set() };
}

async function loadState(state) {
  if (state.loaded) return;
  state.loaded = true;
  const doc = await readJson(state.path).catch(() => null);
  const agents = doc && typeof doc.agents === 'object' && !Array.isArray(doc.agents) ? doc.agents : {};
  for (const [id, value] of Object.entries(agents)) if (value && typeof value === 'object') state.memory.set(id, value);
}

const PRUNE_MS = 7 * 24 * 60 * MINUTE;

async function saveState(state, present, now) {
  for (const [id, entry] of state.memory) {
    if (!present.has(id) && !(now - (entry.triedAt ?? 0) < PRUNE_MS)) state.memory.delete(id);
  }
  if (state.path) await writeJson(state.path, { version: 1, agents: Object.fromEntries(state.memory) }).catch(() => null);
}

/** The refusals that need no look at the pane: decided before anything is read from disk. */
function preflight(row, { leadId, isLead, panes, adapters }) {
  if (!isLead && !leadId) return { refusal: 'no registered repository lead to ask' };
  const pane = panes.find((item) => item.paneId === row.binding.paneId && item.serverKey === row.binding.serverKey);
  const adapter = pane ? adapterForPane(adapters, pane) : null;
  if (ringCapability(adapter) !== 'supported') return { refusal: 'the provider has no measured safe composer' };
  return { adapter };
}

async function ringOne(row, adapter, { consumer, leadId, isLead, wake, tmux }) {
  const text = nudgeText({ consumer, agentId: row.agentId, leadId, isLead });
  const format = composerFormat(adapter, tmuxFailureTrigger(adapter));
  const result = await withServer(row.binding.serverKey, () => wake({ pane: row.binding.paneId, adapter, binding: row.binding, format, text, tmux }))
    .catch((error) => ({ rang: false, reason: error?.code ?? String(error) }));
  return result?.rang ? { rang: true } : { rang: false, reason: result?.reason ?? 'the composer cannot safely receive a pointer' };
}

/**
 * The backoff floor before the next ring: backoff_ms, doubling per ring, capped at max_backoff_ms.
 * A quiet spell of twice the cap since the last ring starts the doubling over.
 */
function floorAfter(prior, settings, now) {
  if (now - prior.rangAt >= 2 * settings.max_backoff_ms) return 0;
  return Math.min(settings.backoff_ms * Math.pow(2, Math.max((prior.rings ?? 1) - 1, 0)), settings.max_backoff_ms);
}

function ringsAfter(prior, settings, now) {
  if (prior.rangAt === undefined || now - prior.rangAt >= 2 * settings.max_backoff_ms) return 1;
  return (prior.rings ?? 1) + 1;
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
  const boardOf = options.readBoard ?? (() => readBoard(consumer));
  let board;
  let changed = false;
  const outcomes = [];
  const refuse = (row, isLead, prior, reason) => {
    changed = true;
    const repeat = prior.refusedSince === row.since && prior.refusedReason === reason;
    state.memory.set(row.agentId, { ...prior, triedAt: now, refusedSince: row.since, refusedReason: reason });
    if (!repeat) outcomes.push({ agent: row.agentId, lead: isLead, rang: false, reason });
  };
  for (const row of candidates) {
    const prior = state.memory.get(row.agentId) ?? {};
    const isLead = row.agentId === leadId || row.repoRole === 'lead';
    const rang = prior.rangAt !== undefined;
    if (prior.rangSince === row.since) continue;
    if (prior.triedAt !== undefined && now - prior.triedAt < settings.retry_ms) continue;
    if (!quietEnough(row, isLead, settings, now)) continue;
    if (rang && now - prior.rangAt < floorAfter(prior, settings, now)) continue;
    const ready = preflight(row, { leadId, isLead, panes, adapters });
    if (ready.refusal) {
      refuse(row, isLead, prior, ready.refusal);
      continue;
    }
    // Change gate, on the board alone, read only for an agent already rung once.
    if (rang) {
      if (board === undefined) {
        board = await boardOf();
        if (board.problem && !state.reported.has(board.problem)) {
          state.reported.add(board.problem);
          outcomes.push({ board: board.problem });
        }
      }
      if (prior.board === board.fingerprint) continue;
    }
    const outcome = await ringOne(row, ready.adapter, { consumer, leadId, isLead, wake, tmux });
    if (!outcome.rang) {
      refuse(row, isLead, prior, outcome.reason);
      continue;
    }
    changed = true;
    // The first ring records the board as it stands then, so only a LATER change reopens the gate.
    if (board === undefined) board = await boardOf();
    state.memory.set(row.agentId, { rangAt: now, rangSince: row.since, board: board.fingerprint, rings: ringsAfter(prior, settings, now), triedAt: now });
    outcomes.push({ agent: row.agentId, lead: isLead, rang: true });
  }
  if (changed) await saveState(state, new Set((census?.agents ?? []).map((row) => row.agentId)), now);
  return outcomes;
}
