/**
 * Text rendering: the board, the SessionStart context block, handoff briefs.
 * All plain strings — the dashboard reads the same data from index.json.
 */
import { existsSync, readFileSync } from "node:fs";
import { acceptanceOpen, config, list, nextTasks, openTasks, read, staleTasks, state } from "./store.mjs";
import { paths } from "./paths.mjs";
import { CATALOG } from "./ntfy.mjs";

/**
 * `proposed` is here because ADRs go through `taskLine` too now that `tm find` renders its hits
 * with it — without it a decision showed up as `? ADR-0001`, which reads as a broken row rather
 * than as a decision nobody has ratified yet.
 */
const MARK = { open: "○", in_progress: "◐", blocked: "⊘", parked: "⏸", done: "●", proposed: "◇" };

export function taskLine(t) {
  const acc = (t.acceptance || []).length;
  const met = acc - acceptanceOpen(t).length;
  return [
    `${MARK[t.status] || "?"} ${t.id}`,
    t.title,
    // `next` is ordered by priority now, so a line that does not show it is a list whose
    // order has no visible reason. Only when it was actually set — an unset field is not a
    // fact about the task, and putting `!medium` on every row buys nothing.
    t.priority ? `!${t.priority}` : "",
    t.epic ? `[${t.epic}]` : "",
    acc ? `(${met}/${acc} AC)` : "",
    (t.blockedBy || []).length ? `blocked-by ${t.blockedBy.join(",")}` : "",
    t.actor && t.actor !== "main" ? t.actor : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function board(p = paths()) {
  const s = state(p);
  const epics = list("epic", {}, p).filter((e) => e.status !== "done");
  const tasks = list("task", {}, p);
  const byStatus = (st) => tasks.filter((t) => t.status === st);
  const out = [`# Board — ${p.root}`, ""];

  out.push(`Active epic: ${s.activeEpic || "(none — set one with `tm epic use <id>`)"}`, "");
  if (epics.length) {
    out.push("## Epics");
    for (const e of epics) {
      const kids = tasks.filter((t) => t.epic === e.id);
      const done = kids.filter((t) => t.status === "done").length;
      out.push(`${MARK[e.status] || "○"} ${e.id} ${e.title} — ${done}/${kids.length} done`);
    }
    out.push("");
  }
  for (const st of ["in_progress", "blocked", "open", "parked"]) {
    const rows = byStatus(st);
    if (!rows.length) continue;
    out.push(`## ${st.replace("_", " ")} (${rows.length})`);
    out.push(...rows.map(taskLine), "");
  }
  const stale = staleTasks(p);
  if (stale.length) {
    out.push(`## stale (> ${config(p).staleMinutes}m untouched)`, ...stale.map(taskLine), "");
  }
  if (tasks.length === 0) out.push("(no tasks yet — `tm task new \"<title>\"`)");
  return out.join("\n");
}

/** Injected at SessionStart. Terse on purpose — it is prepended to every session. */
export function sessionContext(p = paths()) {
  const open = openTasks(p);
  if (open.length === 0 && !state(p).activeEpic) return "";
  const s = state(p);
  const inProgress = open.filter((t) => t.status === "in_progress");
  const next = nextTasks(p).slice(0, 5);
  const stale = staleTasks(p);

  const out = [
    "## task-management (.bytedesk/task-management)",
    "",
    "This project's tasks are owned by the task-management plugin, not by session-local todo state.",
    `Active epic: ${s.activeEpic || "(none set — `tm epic use <id>` or /tm:epic before creating tasks)"}`,
    "",
  ];
  if (inProgress.length) out.push("In progress (claimed):", ...inProgress.map((t) => `- ${taskLine(t)}`), "");
  if (stale.length) out.push(`Stale (untouched > ${config(p).staleMinutes}m) — verify before resuming:`, ...stale.map((t) => `- ${t.id} ${t.title}`), "");
  if (next.length) out.push("Next unblocked:", ...next.map((t) => `- ${taskLine(t)}`), "");
  out.push(
    "",
    "Use `tm` for task state (`tm board`, `tm start <id>`, `tm done <id>`, `tm next`). Native TaskCreate/TaskUpdate calls are mirrored into the store automatically.",
  );
  return out.join("\n");
}

/** Self-contained brief for a subagent, worktree, or tomorrow's session. */
export function handoff(id, p = paths()) {
  const t = read(id, p);
  if (!t) throw new Error(`not found: ${id}`);
  const epic = t.epic ? read(t.epic, p) : null;
  const out = [
    `# Handoff — ${t.id} ${t.title}`,
    "",
    `Status: ${t.status}${t.session ? ` (last touched by session ${t.session})` : ""}`,
    epic ? `Epic: ${epic.id} ${epic.title}` : "Epic: (none)",
    t.branch ? `Branch: ${t.branch}` : undefined,
    t.worktree ? `Worktree: ${t.worktree}` : undefined,
    "",
    "## Context",
    t.body?.trim() || "(none recorded)",
    "",
  ].filter((l) => l !== undefined);

  if ((t.acceptance || []).length) {
    out.push("## Acceptance criteria", ...t.acceptance.map((a) => `- [${a.done ? "x" : " "}] ${a.text}`), "");
  }
  if ((t.blockedBy || []).length) out.push(`## Blocked by`, ...t.blockedBy.map((d) => `- ${d}`), "");
  if ((t.evidence || []).length) out.push("## Evidence", ...t.evidence.map((e) => `- ${e}`), "");
  if ((t.commits || []).length) out.push("## Commits / PRs", ...t.commits.map((c) => `- ${c}`), "");
  if (epic?.body?.trim()) out.push("## Epic context", epic.body.trim(), "");
  out.push(`Resume with: tm start ${t.id}`);
  return out.join("\n");
}

/** What changed since <iso>, read straight off the event log. */
export function standup(sinceIso, p = paths()) {
  if (!existsSync(p.events)) return "(no events yet)";
  const since = Date.parse(sinceIso);
  const rows = readFileSync(p.events, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((e) => e && Date.parse(e.ts) >= since);
  if (!rows.length) return `(nothing since ${sinceIso})`;

  const byId = new Map();
  for (const e of rows) {
    if (!e.id) continue;
    if (!byId.has(e.id)) byId.set(e.id, []);
    byId.get(e.id).push(e);
  }
  const out = [`# Since ${sinceIso}`, ""];
  for (const [id, events] of byId) {
    const t = read(id, p);
    out.push(`- ${id} ${t?.title || ""} — ${events.map((e) => e.event).join(" → ")}${t ? ` (now ${t.status})` : ""}`);
  }
  const closed = rows.filter((e) => e.event === "done").length;
  out.push("", `${rows.length} events, ${closed} task(s) closed.`);
  return out.join("\n");
}

// ── the event log, for a person ──────────────────────────────────────────────

/**
 * `tm log` had no human rendering: its human branch was `rows.map(JSON.stringify)`, byte-identical
 * in intent to `--json`. Every other read verb has a renderer — board, taskLine, handoff, standup,
 * renderWhy, renderDoctor — and the log, the one surface you reach for when two agents disagreed
 * about a claim or a card moved and nobody knows who moved it, was raw JSONL.
 *
 * Two shapes, because two questions:
 *   `tm log [n]`   the tail across the store — what has been happening
 *   `tm log <id>`  one entity's whole history — a per-issue changelog, which is the Jira surface
 *                  this store did not have
 *
 * The human label per event kind is NOT redefined here. `CATALOG.events` in lib/ntfy.mjs already
 * carries one for every kind the store emits, and a test derives that list from the source, so
 * reusing it means a new event gets a sentence in both places or neither.
 */

/** Fields that are context rather than payload; everything else is what the event is about. */
const LOG_META = new Set(["ts", "event", "session", "actor", "id"]);

function eventDetail(e) {
  const parts = [];
  for (const [k, v] of Object.entries(e)) {
    if (LOG_META.has(k) || v === null || v === undefined || v === "") continue;
    const text = Array.isArray(v) ? v.join(", ") : String(v);
    if (!text) continue;
    parts.push(k === "patch" || k === "status" ? `${k}=${text}` : text);
  }
  return parts.join("  ").slice(0, 100);
}

const hhmm = (ts) => String(ts).slice(11, 16);
const dayOf = (ts) => String(ts).slice(0, 10);

/**
 * The tail. Grouped by day, because a bare timestamp on every line is noise when forty of them
 * share a date and the useful comparison is "what happened today".
 */
export function renderLog(rows, p = paths()) {
  if (!rows.length) return "(no events)";
  const labels = CATALOG.events;
  const out = [];
  let day = null;
  for (const e of rows) {
    const d = dayOf(e.ts);
    if (d !== day) {
      out.push(day ? "" : "", d);
      day = d;
    }
    const label = labels[e.event]?.label || e.event;
    const detail = eventDetail(e);
    out.push(
      [
        `  ${hhmm(e.ts)}`,
        (e.actor || "—").padEnd(8).slice(0, 8),
        (e.id || "").padEnd(8),
        label,
        detail ? `— ${detail}` : "",
      ]
        .join(" ")
        .trimEnd(),
    );
  }
  void p;
  return out.filter((l, i) => !(i === 0 && l === "")).join("\n");
}

/**
 * One entity's history: the per-issue changelog.
 *
 * Elapsed time is shown against the FIRST start rather than against the previous line, because the
 * question a changelog answers is "how long did this take", and a delta-per-row makes the reader
 * add up a column to find out.
 */
export function renderHistory(id, rows, p = paths()) {
  const doc = read(id, p);
  if (!rows.length) return `${id}${doc ? ` ${doc.title}` : ""}\n(no events — nothing has happened to it)`;

  const labels = CATALOG.events;
  const collapsed = collapseLog(rows);
  const started = rows.find((e) => e.event === "update" && e.status === "in_progress")?.ts || null;
  const out = [`${id}${doc ? `  ${doc.title}` : ""}`, doc ? `status: ${doc.status}` : "", ""].filter(Boolean);

  for (const e of collapsed) {
    const label = e.event === "status" ? `→ ${e._status}` : labels[e.event]?.label || e.event;
    const detail = e.event === "status" ? "" : eventDetail(e);
    const since = started && Date.parse(e.ts) > Date.parse(started) ? ` (+${humanSince(started, e.ts)})` : "";
    out.push(`  ${dayOf(e.ts)} ${hhmm(e.ts)}  ${label}${detail ? `  — ${detail}` : ""}${since}`);
  }
  return out.join("\n");
}

/**
 * Every semantic write logs twice: `prioritise()` calls `update()` — which logs `update` — and then
 * logs `prioritise`. In a tail that is tolerable; in a changelog it doubles every row and buries
 * the fact under its own bookkeeping.
 *
 * So an `update` is dropped when a more specific event for the same entity landed in the same
 * second. An `update` with nothing beside it is kept, because then it IS the fact — and a status
 * change is promoted to its own line, since "what state did this go through" is the question a
 * changelog exists to answer.
 */
export function collapseLog(rows) {
  const specific = new Set();
  for (const e of rows) {
    if (e.event !== "update") specific.add(`${e.id || ""}@${String(e.ts).slice(0, 19)}`);
  }
  const out = [];
  let status = null;
  for (const e of rows) {
    if (e.event === "update") {
      const moved = e.status && e.status !== status;
      if (moved) {
        status = e.status;
        out.push({ ...e, event: "status", _status: e.status });
        continue;
      }
      if (specific.has(`${e.id || ""}@${String(e.ts).slice(0, 19)}`)) continue;
    } else if (e.status) {
      status = e.status;
    }
    out.push(e);
  }
  return out;
}

/** Coarse on purpose: a changelog wants "3h", not "3h 07m 12s". */
function humanSince(from, to) {
  const ms = Date.parse(to) - Date.parse(from);
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h${m % 60 ? ` ${m % 60}m` : ""}` : `${Math.floor(h / 24)}d${h % 24 ? ` ${h % 24}h` : ""}`;
}
