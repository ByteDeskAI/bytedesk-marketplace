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

// ── TaskCreate gate ──────────────────────────────────────────────────────────

export function gateTaskCreate(p = paths()) {
  if (enforcementOff(p)) return { allow: true };
  const cfg = config(p);
  const s = state(p);

  if (cfg.requireEpic && !s.activeEpic) {
    if (consumeOverride(p)) return { allow: true };
    return {
      allow: false,
      reason:
        "task-management: no active epic. Every task belongs to an epic so work survives this session.\n" +
        "Pick one:  tm epic use <EP-id>   |   tm epic new \"<title>\"   |   /tm:epic\n" +
        `Open epics: ${epicList(p) || "(none yet)"}\n` +
        "Bypass once: tm override \"<reason>\"   Disable: TM_ENFORCE=off",
    };
  }

  const wip = list("task", { status: "in_progress" }, p).length;
  if (cfg.wipLimit && wip >= cfg.wipLimit) {
    if (consumeOverride(p)) return { allow: true };
    return {
      allow: false,
      reason:
        `task-management: WIP limit reached (${wip}/${cfg.wipLimit} in progress). Finish or park one first:\n` +
        `  tm done <id>   |   tm block <id> "<why>"   |   tm board\n` +
        "Bypass once: tm override \"<reason>\"",
    };
  }
  return { allow: true };
}

function epicList(p) {
  return list("epic", {}, p)
    .filter((e) => e.status !== "done")
    .map((e) => `${e.id} ${e.title}`)
    .join(", ");
}

// ── done gate ────────────────────────────────────────────────────────────────

export function gateDone(id, p = paths()) {
  if (enforcementOff(p)) return { allow: true };
  if (!config(p).requireAcceptance) return { allow: true };
  const task = read(id, p);
  if (!task) return { allow: false, reason: `not found: ${id}` };
  const open = acceptanceOpen(task);
  if (open.length === 0) return { allow: true };
  if (consumeOverride(p)) return { allow: true };
  return {
    allow: false,
    reason:
      `${id} has unmet acceptance criteria:\n` +
      open.map((a) => `  [ ] ${a.text}`).join("\n") +
      `\nTick them:  tm accept ${id} <n>    Bypass once: tm override "<reason>"`,
  };
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
  const mine = list("task", { status: "in_progress" }, p).filter(
    (t) => !session || !t.session || t.session === session,
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
  return {
    block: true,
    reason:
      "task-management: these tasks are still in_progress. Close them out before stopping so the next session inherits the truth:\n" +
      mine
        .map((t) => `  ${t.id} ${t.title}\n    tm done ${t.id}  |  tm block ${t.id} "<why>"  |  tm park ${t.id}`)
        .join("\n") +
      "\nIf the work really is unfinished, park it with a note — don't leave it in_progress.",
  };
}
