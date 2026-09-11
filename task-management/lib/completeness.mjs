/**
 * Required-field completeness: what a task must carry before a gate lets it move.
 *
 * A task used to be closable with nothing but ticked criteria — no body, no
 * criteria at all (an empty list has nothing unticked, so requireAcceptance
 * passed it), no proof, no name on the work. The board was accumulating cards
 * that recorded THAT something happened and nothing else. The gates in
 * enforce.mjs refuse those transitions; this module answers the one question
 * they share: which details are missing, and which verb fills each gap.
 *
 * Pure by design — no store reads, no clock. The gates hand it a task (or a
 * create draft, which is just the fields a create was given) plus the field
 * list from config; it returns one { field, hint } per gap, the hint naming
 * the exact fix command so the refusal, `tm doctor` and the MCP error all tell
 * the user the same remedy.
 *
 * `p` is part of the signature for the field checks that will need the store
 * (an evidence path that must exist on disk is the known one). The four fields
 * below do not, and an unused default keeps the hook paths allocation-free.
 */

const idOf = (task) => task?.id ?? "<id>";

const FIELDS = {
  // The markdown body is the context: what and why. A title alone is a rumor.
  body: {
    missing: (t) => !String(t.body ?? "").trim(),
    hint: (id) => `tm edit ${id} --body`,
  },
  /**
   * At least one criterion must EXIST. Whether they are ticked is the done
   * gate's older requireAcceptance check; this closes the zero-AC hole that
   * check cannot see, because an empty list has no unticked entries.
   */
  acceptance: {
    missing: (t) => !(t.acceptance || []).length,
    hint: (id) => `tm ac ${id} "…"`,
  },
  // Proof, not claims: test output, a screenshot, a worktree path.
  evidence: {
    missing: (t) => !(t.evidence || []).length,
    hint: (id) => `tm evidence ${id} <path|->`,
  },
  /**
   * Who did the work. `actor` is what the start/dispatch paths stamp on the
   * task; `assignee` is the stored Jira-shaped field (`tm assign`). Either
   * attributes the close.
   */
  actor: {
    missing: (t) => !String(t.actor ?? t.assignee ?? "").trim(),
    hint: (id) => `tm assign ${id} <who>`,
  },
};

/**
 * The gaps in `task` against a config field list, e.g.
 * `missingFields(task, config(p).requireOnDone)` → [{ field, hint }, …].
 *
 * Unknown field names are skipped rather than thrown on: a typo'd config key
 * is `tm doctor`'s finding to report, not a reason to crash a hook that is
 * mid-transition. An empty or absent list checks nothing, which is how a
 * project turns one of these gates' completeness half off.
 */
export function missingFields(task, required, p = null) {
  const t = task || {};
  const out = [];
  for (const field of required || []) {
    const spec = FIELDS[field];
    if (spec && spec.missing(t)) out.push({ field, hint: spec.hint(idOf(t)) });
  }
  return out;
}

/**
 * Decision-role and triage vocabularies.
 *
 * Defined here rather than in issue.mjs because the store's own write keeps the triage label in
 * sync, and store.mjs must never import issue.mjs — issue.mjs is built on the store. This module
 * has no imports, so both can depend on it. issue.mjs and decision.mjs re-export these same
 * arrays, so every existing import keeps working and there is still exactly one copy.
 */
export const DECISION_MAP = "decision:map";
export const DECISION_KIND = ["decision:interview", "decision:research", "decision:prototype", "decision:unblock"];
export const TRIAGE_LABELS = ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"];

/**
 * Labels that hand the next move to a person. `decision:research` is absent on purpose: it is the
 * AFK role (decision.mjs `attentionOf`), the one decision an agent can answer on its own.
 */
const NOT_FOR_AGENTS = [
  "ready-for-human",
  "needs-info",
  "wontfix",
  "human-gate",
  "decision:interview",
  "decision:prototype",
  "decision:unblock",
  DECISION_MAP,
];

/** `missingFields` names config keys; a card names the thing a person has to fill in. */
const SPOKEN = { acceptance: "acceptance criteria" };

/**
 * Is this task specified well enough to hand to an agent? → `{ ready, missing }`.
 *
 * The one implementation. The store's write path labels tasks with it; anything else asking the
 * question should call this rather than re-derive it. `cfg` is `config(p)`: `requireOnStart` is
 * the start gate's field list, so a task the label calls ready is one `tm start` will accept.
 *
 * Status and dependencies are deliberately not consulted. The label means "specified"; whether
 * the task is startable right now is the pool's separate check, and folding it in here would flip
 * the label every time a blocker opened or closed.
 */
export function agentReadiness(task, cfg = {}) {
  const t = task || {};
  const labels = t.labels || [];
  const missing = missingFields(t, cfg.requireOnStart).map(({ field }) => SPOKEN[field] ?? field);
  if (cfg.requireEpic && !t.epic) missing.push("epic");
  for (const label of NOT_FOR_AGENTS) if (labels.includes(label)) missing.push(`label ${label}`);
  return { ready: missing.length === 0, missing };
}
