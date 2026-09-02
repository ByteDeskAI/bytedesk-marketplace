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
