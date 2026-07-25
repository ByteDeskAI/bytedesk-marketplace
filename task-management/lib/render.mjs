/**
 * Text rendering: the board, the SessionStart context block, handoff briefs.
 * All plain strings — the dashboard reads the same data from index.json.
 */
import { existsSync, readFileSync } from "node:fs";
import { acceptanceOpen, config, list, nextTasks, openTasks, read, staleTasks, state } from "./store.mjs";
import { paths } from "./paths.mjs";

const MARK = { open: "○", in_progress: "◐", blocked: "⊘", parked: "⏸", done: "●" };

export function taskLine(t) {
  const acc = (t.acceptance || []).length;
  const met = acc - acceptanceOpen(t).length;
  return [
    `${MARK[t.status] || "?"} ${t.id}`,
    t.title,
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
