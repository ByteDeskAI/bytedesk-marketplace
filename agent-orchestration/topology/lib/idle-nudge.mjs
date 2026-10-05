// TM-408. AN IDLE AGENT PULLS ITS NEXT ASSIGNMENT; IT NEVER ASKS THE OPERATOR "WHAT NEXT?".
//
// The prompts state the rule (prompts/common.md, prompts/lead.md, the generated Protocol section,
// the role packs). This is the supervisor's half: when the census sees a standing agent idle and
// dispatchable, ring its pane once with the pull it should make — a worker asks its repository
// lead through the standing mailbox, a lead takes the next ready task from its own board. The bell
// is the same safe one probes use (`wakeForProbe` -> `checkBellSafe`): alive, binding intact,
// composer empty, no attention or failure screen. A draft in the box or a tool prompt on screen
// types NOTHING.
//
// Rate: once per idle period (the census row's `since`, which resets on every state change), never
// again sooner than `backoff_ms` after the last ring, and a refused ring is retried no more often
// than `retry_ms`. A ring is itself a turn, so without the backoff an idle lead with nothing ready
// would be rung, answer "nothing ready", go idle and be rung again forever.
//
// Scope: standing agents only. A run agent belongs to its conductor, which briefs and waits on it;
// the reviewer is excluded because it is read-only and cannot run the mailbox command.
//
// Config, in any AO layer: the `idle_nudge` object with `enabled` (default true, as the operator
// asked; false is the off switch), `backoff_ms` (default 30 minutes) and `retry_ms` (default 60 s).
//
// ponytail: memory is per supervisor process, so a restarted supervisor may ring an already-idle
// agent once more. Persist it beside the census if restarts ever make that noisy.
import { homedir } from 'node:os';
import { adapterForPane } from './census.mjs';
import { loadConfig } from './config.mjs';
import { composerFormat, ringCapability, wakeForProbe } from './delivery.mjs';
import { tmuxFailureTrigger } from './launch.mjs';
import { readLeadRegistration } from './lead.mjs';
import { tmux as defaultTmux, withServer } from './tmux.mjs';
import { shellQuote } from './util.mjs';

export const IDLE_NUDGE_DEFAULTS = Object.freeze({ enabled: true, backoff_ms: 30 * 60_000, retry_ms: 60_000 });

export function idleNudgeConfig(config) {
  const raw = config?.idle_nudge ?? {};
  const ms = (value, fallback) => (Number.isFinite(value) && value >= 0 ? value : fallback);
  return { enabled: raw.enabled !== false, backoff_ms: ms(raw.backoff_ms, IDLE_NUDGE_DEFAULTS.backoff_ms), retry_ms: ms(raw.retry_ms, IDLE_NUDGE_DEFAULTS.retry_ms) };
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

export function createIdleNudge() { return { memory: new Map() }; }

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

/**
 * One supervisor tick. `census` is the document the tick just took; `panes` the same listing.
 * Returns only the agents it rang or refused, so a quiet repository reports nothing.
 */
export async function idleNudgeTick(options, { census, panes, adapters, state = createIdleNudge(), now = Date.now(), tmux = defaultTmux, wake = wakeForProbe, config } = {}) {
  const { consumer, env = process.env, home = homedir(), pluginRoot = null } = options;
  const settings = idleNudgeConfig(config !== undefined ? config : (await loadConfig({ consumer, home, env, pluginRoot })).config);
  if (!settings.enabled || census?.stale || !Array.isArray(panes) || !adapters) return [];
  const candidates = (census?.agents ?? []).filter((row) => row.dispatchable && row.state === 'idle' && !row.runId && row.repoRole !== 'reviewer' && row.binding?.paneId);
  if (!candidates.length) return [];
  const registration = await (options.readLead ?? readLeadRegistration)({ consumer, env, home }).catch(() => null);
  const leadId = registration?.record?.agent_id ?? null;
  const outcomes = [];
  for (const row of candidates) {
    const prior = state.memory.get(row.agentId);
    if (prior?.rangSince === row.since) continue;
    if (prior?.rangAt !== undefined && now - prior.rangAt < settings.backoff_ms) continue;
    if (prior?.triedAt !== undefined && now - prior.triedAt < settings.retry_ms) continue;
    const isLead = row.agentId === leadId || row.repoRole === 'lead';
    const outcome = await ringOne(row, { consumer, leadId, isLead, panes, adapters, wake, tmux });
    state.memory.set(row.agentId, { ...prior, triedAt: now, ...(outcome.rang ? { rangAt: now, rangSince: row.since } : {}) });
    outcomes.push({ agent: row.agentId, lead: isLead, ...outcome });
  }
  return outcomes;
}
