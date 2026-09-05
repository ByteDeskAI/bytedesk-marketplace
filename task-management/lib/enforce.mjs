/**
 * Every gate decision lives here so the hooks stay dumb wrappers and the
 * behavior is unit-testable without Claude Code in the loop.
 *
 * Escape hatches (the plan calls these non-negotiable):
 *   - TM_ENFORCE=off / config.enforce=false  → all gates open
 *   - `tm override <reason>`                 → one-shot token, consumed by the next gate
 *   - the Stop gate never blocks twice in a row for the same task set
 */
import { acceptanceOpen, config, list, logEvent, now, read, state, withLock, writeState } from "./store.mjs";
import { paths } from "./paths.mjs";
import { sessionId } from "./actor.mjs";
import { decisionRole, hasAnswer } from "./decision.mjs";
import { missingFields } from "./completeness.mjs";

export function enforcementOff(p = paths()) {
  if (String(process.env.TM_ENFORCE || "").toLowerCase() === "off") return true;
  return config(p).enforce === false;
}

export function setOverride(reason, p = paths()) {
  writeState({ override: { reason, ts: now() } }, p);
  logEvent("override", { reason }, p);
}

/**
 * Returns the override reason and clears it, or null.
 *
 * Read-then-clear, so it has to be atomic: `tm override` mints exactly ONE token, and
 * two gates evaluating at the same moment would both read it, both pass, and both write
 * null — one token spent twice. A gate that can be bypassed twice per token is not a
 * gate, and nothing in the event log would show it (two `override_used` entries for one
 * `override` is the only trace, and nobody reads that).
 */
export function consumeOverride(p = paths()) {
  return withLock(p, () => {
    const s = state(p);
    if (!s.override) return null;
    writeState({ override: null }, p);
    logEvent("override_used", { reason: s.override.reason }, p);
    return s.override.reason;
  });
}

/**
 * The override reason WITHOUT spending it.
 *
 * For a caller that has to decide whether a write would be allowed before it is entitled to
 * perform one — a preview, an approval card. Spending a one-shot token to answer a question
 * nobody acted on is how the operator's single bypass disappears into a page refresh.
 */
export function peekOverride(p = paths()) {
  return state(p).override?.reason ?? null;
}

// ── TaskCreate gate ──────────────────────────────────────────────────────────

/**
 * `consume: false` asks the gate what it WOULD say without changing anything, and reports
 * `override: true` on an answer that only came out `allow` because a one-shot token exists. The
 * caller that goes on to write is then the one that spends it, once, where the write happens.
 */
export function gateTaskCreate(p = paths(), draft = null, { consume = true, haveEpic = false } = {}) {
  const takeOverride = () => (consume ? consumeOverride(p) : peekOverride(p));
  if (enforcementOff(p)) return { allow: true };
  const cfg = config(p);
  const s = state(p);

  // `haveEpic` says the CALLER is supplying the epic, so the active-epic rule does not apply to it
  // — a planner proposal that creates its own epic and files tasks under it, for instance. It
  // skips only this rule. Suppressing the whole refusal at the call site could not do that: this
  // check RETURNS, so the completeness and WIP gates below it never ran, and a proposal naming an
  // existing epic sailed past both whenever no epic happened to be active.
  if (cfg.requireEpic && !s.activeEpic && !haveEpic) {
    if (takeOverride()) return { allow: true, override: true };
    return {
      allow: false,
      reason:
        "task-management: no active epic. Every task belongs to an epic so work survives this session.\n" +
        "Pick one:  .bytedesk/task-management/bin/tm epic use <EP-id>   |   .bytedesk/task-management/bin/tm epic new \"<title>\"   |   /task-management:epic\n" +
        `Open epics: ${epicList(p) || "(none yet)"}\n` +
        "Bypass once: .bytedesk/task-management/bin/tm override \"<reason>\"   Disable: TM_ENFORCE=off",
    };
  }

  /**
   * Explicit creates carry their details from birth; harness mirrors do not.
   *
   * `draft` is null on exactly one path: the pre-create hook for a native tool
   * mirror (TaskCreate / update_plan / todo_write), where the task arrives as
   * the harness's own todo state and fleshes out as the mirror learns more —
   * gating that on completeness would deny every native todo. An explicit
   * create (CLI `task new`, MCP `tm_task_create`, POST /api/task) passes what
   * it was given, and a bare title no longer gets through.
   *
   * Before the WIP check on purpose: this and requireEpic refuse a malformed
   * request, WIP refuses a busy board. The request is what the caller can fix
   * without finishing something first.
   */
  if (draft) {
    const missing = missingFields(draft, cfg.requireOnCreate, p);
    if (missing.length) {
      if (takeOverride()) return { allow: true, override: true };
      return {
        allow: false,
        reason: missingRefusal(
          "task-management: new tasks carry their details from birth — missing",
          missing,
          "Or supply them at creation: .bytedesk/task-management/bin/tm task new \"<title>\" --body <text|-> --ac \"<criterion>\"",
        ),
      };
    }
  }

  const wip = list("task", { status: "in_progress" }, p).length;
  if (cfg.wipLimit && wip >= cfg.wipLimit) {
    if (takeOverride()) return { allow: true, override: true };
    return {
      allow: false,
      reason:
        `task-management: WIP limit reached (${wip}/${cfg.wipLimit} in progress). Finish or park one first:\n` +
        `  .bytedesk/task-management/bin/tm done <id>   |   .bytedesk/task-management/bin/tm block <id> "<why>"   |   .bytedesk/task-management/bin/tm board\n` +
        "Bypass once: .bytedesk/task-management/bin/tm override \"<reason>\"",
    };
  }
  return { allow: true };
}

// ── start gate ───────────────────────────────────────────────────────────────

/**
 * The WIP limit, for `tm start`, `tm_task_update start` and the dashboard's transition.
 *
 * This check lived in bin/tm and again in lib/mcp.mjs — duplicated rather than bypassed, as the
 * comment there admitted — and nowhere at all in the dashboard, so the board could exceed the
 * limit the terminal enforced. A task already in progress is not counted against itself: resuming
 * is not starting.
 */
export function gateStart(id, p = paths()) {
  if (enforcementOff(p)) return { allow: true };
  const cfg = config(p);
  const wip = list("task", { status: "in_progress" }, p);
  if (cfg.wipLimit && wip.length >= cfg.wipLimit && !wip.some((w) => w.id === id)) {
    if (consumeOverride(p)) return { allow: true };
    return { allow: false, reason: `WIP limit ${cfg.wipLimit} reached: ${wip.map((w) => w.id).join(", ")}` };
  }
  // Starting an empty card commits a session to work nobody can reconstruct:
  // the body is the context, the criteria are what "finished" will mean. An
  // unknown id skips this — not-found is the caller's refusal to make.
  const task = read(id, p);
  const missing = task ? missingFields(task, cfg.requireOnStart, p) : [];
  if (missing.length) {
    if (consumeOverride(p)) return { allow: true };
    return { allow: false, reason: missingRefusal(`${id} is missing what starting needs`, missing) };
  }
  return { allow: true };
}

function epicList(p) {
  return list("epic", {}, p)
    .filter((e) => e.status !== "done")
    .map((e) => `${e.id} ${e.title}`)
    .join(", ");
}

/**
 * One refusal shape for every completeness gate: what is missing, the exact
 * verb that fills each gap, then the one-shot escape. The hint text comes from
 * completeness.mjs, so the refusal names the same command a doctor finding does.
 */
function missingRefusal(what, missing, extra = "") {
  return (
    `${what}:\n` +
    missing.map((m) => `  ${m.field} — ${m.hint}`).join("\n") +
    (extra ? `\n${extra}` : "") +
    `\nBypass once: .bytedesk/task-management/bin/tm override "<reason>"`
  );
}

// ── done gate ────────────────────────────────────────────────────────────────

export function gateDone(id, p = paths()) {
  if (enforcementOff(p)) return { allow: true };
  const task = read(id, p);
  if (!task) return { allow: false, reason: `not found: ${id}` };

  if (config(p).requireAcceptance) {
    const open = acceptanceOpen(task);
    if (open.length) {
      if (consumeOverride(p)) return { allow: true };
      return {
        allow: false,
        reason:
          `${id} has unmet acceptance criteria:\n` +
          open.map((a) => `  [ ] ${a.text}`).join("\n") +
          `\nTick them:  .bytedesk/task-management/bin/tm accept ${id} <n>    Bypass once: .bytedesk/task-management/bin/tm override "<reason>"`,
      };
    }
  }

  const role = decisionRole(task.labels);
  if (role && !hasAnswer(task.body)) {
    if (consumeOverride(p)) return { allow: true };
    return {
      allow: false,
      reason:
        `${id} is a ${role} ticket — write the answer under ## Answer before closing.\n` +
        `  .bytedesk/task-management/bin/tm edit ${id} --body -    Bypass once: .bytedesk/task-management/bin/tm override "<reason>"`,
    };
  }
  if (
    (role === "decision:prototype" || role === "decision:research") &&
    !(task.evidence || []).length
  ) {
    if (consumeOverride(p)) return { allow: true };
    const what = role === "decision:prototype" ? "the variant the human chose" : "the research pack";
    return {
      allow: false,
      reason:
        `${id} needs evidence (${what}) before it can close.\n` +
        `  .bytedesk/task-management/bin/tm evidence ${id} <path>    Bypass once: .bytedesk/task-management/bin/tm override "<reason>"`,
    };
  }
  /**
   * The full record on close: context, at least one criterion, proof, a name.
   *
   * requireAcceptance above only sees criteria that exist — an empty list has
   * nothing unticked, so a bare task closed clean. Every AC-gated task was one
   * bare create (or one `tm ac <id> --rm`) from an ungated done. Evidence and
   * actor close the other two shapes of the same lie: "it works" with nothing
   * attached, and finished work nobody owns.
   */
  const missing = missingFields(task, config(p).requireOnDone, p);
  if (missing.length) {
    if (consumeOverride(p)) return { allow: true };
    return { allow: false, reason: missingRefusal(`${id} is missing what closing needs`, missing) };
  }
  return { allow: true };
}

// ── Stop gate ────────────────────────────────────────────────────────────────

export function gateStop(p = paths()) {
  if (enforcementOff(p)) return { block: false };
  // `lastStopBlock` is read, compared and rewritten — the "never block twice in a row"
  // promise is a read-modify-write on one key. Two Stop hooks arriving together both
  // read the same value, so either both block (two nudges for one set, which is the
  // thing this state exists to prevent) or both release. Reentrant, so the
  // consumeOverride below nests safely.
  return withLock(p, () => gateStopLocked(p));
}

function gateStopLocked(p) {
  const session = sessionId();
  const s = state(p);
  const claims = s.claims || {};
  const mine = list("task", { status: "in_progress" }, p).filter(
    (t) =>
      (!session || !t.session || t.session === session) &&
      // A task marked `dispatched` whose claim belongs to THIS session has already been handed to
      // the pool: the collector (lib/dispatch/collect.mjs) owns the outcome from here, and its
      // park-on-failure path is the backstop for a worker that dies mid-run. Blocking this
      // session's stop over it would nag the worker for a hand-off that already happened.
      // Anonymous sessions (no resolvable id) get no exemption — they cannot prove the claim.
      !(session && t.dispatched && claims[t.id]?.session === session),
  );
  if (mine.length === 0) {
    if (s.lastStopBlock) writeState({ lastStopBlock: null }, p);
    return { block: false };
  }

  const key = mine.map((t) => t.id).sort().join(",");
  // Never block twice in a row on the same set — one nudge, then get out of the way.
  if (s.lastStopBlock === key) {
    writeState({ lastStopBlock: null }, p);
    logEvent("stop_gate_released", { tasks: key }, p);
    return { block: false };
  }
  if (consumeOverride(p)) return { block: false };

  writeState({ lastStopBlock: key }, p);
  logEvent("stop_gate_blocked", { tasks: key }, p);
  /**
   * `/goal` registers its own Stop hook, so two things can block one stop.
   *
   * They are not in conflict — a goal says "keep going until X" and this gate says "do not leave
   * work in_progress" — but two separate refusals for one stop read as the tool nagging twice. When
   * a goal has been recorded against the work, the gate names it, so the two arrive as one story:
   * here is the goal, and here is what the store still needs before it is finished with.
   */
  const goals = mine.flatMap((t) =>
    (t.comments || [])
      .map((c) => String(c.text || ""))
      .filter((text) => text.startsWith("goal: "))
      .slice(-1)
      .map((text) => `  ${t.id}: ${text.slice(6)}`),
  );

  return {
    block: true,
    reason:
      "task-management: these tasks are still in_progress. Close them out before stopping so the next session inherits the truth:\n" +
      mine
        .map((t) => `  ${t.id} ${t.title}\n    .bytedesk/task-management/bin/tm done ${t.id}  |  .bytedesk/task-management/bin/tm block ${t.id} "<why>"  |  .bytedesk/task-management/bin/tm park ${t.id}`)
        .join("\n") +
      (goals.length ? `\nThe goal you set on this work:\n${goals.join("\n")}` : "") +
      "\nIf the work really is unfinished, park it with a note — don't leave it in_progress.",
  };
}
