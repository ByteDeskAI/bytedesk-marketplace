/**
 * Text rendering: the board, the SessionStart context block, handoff briefs.
 * All plain strings — the dashboard reads the same data from index.json.
 */
import { existsSync, readFileSync } from "node:fs";
import { acceptanceOpen, config, list, nextTasks, openTasks, read, readEvents, staleTasks, state } from "./store.mjs";
import { paths } from "./paths.mjs";
import { CATALOG } from "./ntfy.mjs";

/**
 * `proposed` is here because ADRs go through `taskLine` too now that `tm find` renders its hits
 * with it — without it a decision showed up as `? ADR-0001`, which reads as a broken row rather
 * than as a decision nobody has ratified yet.
 */
const MARK = { backlog: "·", open: "○", in_progress: "◐", blocked: "⊘", parked: "⏸", done: "●", proposed: "◇" };

/**
 * Column order and display names, in one place because `tm board`, `tm sprint` and the SPA all
 * have to agree — a board that reads differently in the terminal and the browser is worse than
 * either alone.
 *
 * `open` is displayed as "todo": it has always meant "on the list, nobody has started it", and
 * naming it after where the task is *not* was the confusing part. Backlog is the genuinely new
 * state, for work that is real but not yet queued — it is deliberately outside store.OPEN, so it
 * never surfaces in `tm next`.
 */
export const COLUMNS = ["backlog", "open", "in_progress", "blocked", "parked", "done"];
export const LABEL = { backlog: "backlog", open: "todo", in_progress: "in progress", blocked: "blocked", parked: "parked", done: "done" };
export const label = (status) => LABEL[status] || String(status).replace("_", " ");

/**
 * How much of a stop reason fits on a board line.
 *
 * ponytail: a fixed clamp, because the board is for scanning and one 300-word reason would push
 * every other row off the screen. `tm show <id>` and `tm why <id>` print it whole, and the line
 * ends in `…` so it is visibly abridged rather than quietly wrong.
 */
const REASON_MAX = 60;

/**
 * Why a task stopped, when it did.
 *
 * `tm park <id> <why>` and `tm block <id> <why>` have always stored this, and the board — the
 * first thing anyone looks at on either surface — showed nothing. `tm why <id>` printed it, one
 * task at a time, which means the answer to "what is everything stuck on" was N commands. The
 * user typed a sentence and the tool swallowed it.
 */
function stopReason(t) {
  const why = t.status === "blocked" ? t.blockedReason : t.status === "parked" ? t.parkedReason : null;
  if (!why) return "";
  const flat = String(why).replace(/\s+/g, " ").trim();
  return flat.length > REASON_MAX ? `— ${flat.slice(0, REASON_MAX - 1)}…` : `— ${flat}`;
}

export function taskLine(t) {
  const acc = (t.acceptance || []).length;
  const met = acc - acceptanceOpen(t).length;
  return [
    `${MARK[t.status] || "?"} ${t.id}`,
    t.title,
    // Right after the title, because it is the reason this row is in the section you are
    // reading — not one more attribute to be scanned past at the end of the line.
    stopReason(t),
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

/**
 * A sprint, and what it committed to.
 *
 * This is the report `estimate` never had a consumer for. Points were writable from three surfaces
 * and read by nothing: `burndown` counts CARDS, so a two-point card and a thirteen-point card moved
 * the same line by the same amount. Committed-versus-done in points is the number a sprint exists
 * to produce, and it needs somewhere to be asked for.
 *
 * Cards with no estimate are counted separately rather than treated as zero. A sprint that is "12
 * of 20 points done, and four cards nobody sized" is telling you something true; folding the
 * unsized into 0 would report the same sprint as further along than it is.
 */
export function sprintReport(id, p = paths()) {
  const sprint = read(id, p);
  if (!sprint) throw new Error(`not found: ${id}`);
  const tasks = list("task", {}, p).filter((t) => t.sprint === id);

  const pts = (t) => (typeof t.estimate === "number" ? t.estimate : null);
  const sized = tasks.filter((t) => pts(t) !== null);
  const unsized = tasks.length - sized.length;
  const committed = sized.reduce((n, t) => n + pts(t), 0);
  const done = sized.filter((t) => t.status === "done").reduce((n, t) => n + pts(t), 0);

  const out = [
    `${sprint.id}  ${sprint.title}`,
    `status: ${sprint.status}${sprint.ends ? `   ends: ${sprint.ends}` : ""}`,
    "",
  ];
  if (!tasks.length) {
    out.push("Nothing committed yet — `tm sprint add <id>...`");
    return out.join("\n");
  }
  out.push(
    `${done}/${committed} points done across ${tasks.length} card(s)` +
      (unsized ? `, ${unsized} unsized` : ""),
    "",
  );
  for (const status of COLUMNS) {
    const rows = tasks.filter((t) => t.status === status);
    if (!rows.length) continue;
    out.push(`## ${label(status)} (${rows.length})`, ...rows.map((t) => taskLine(t)), "");
  }
  if (unsized) {
    out.push(`${unsized} card(s) carry no estimate, so they are outside the point total:`);
    out.push(...tasks.filter((t) => pts(t) === null).map((t) => `  ${t.id} ${t.title}`), "");
  }
  return out.join("\n").trimEnd();
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
  for (const st of COLUMNS.filter((c) => c !== "done")) {
    const rows = byStatus(st);
    if (!rows.length) continue;
    out.push(`## ${label(st)} (${rows.length})`);
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
    "Use `tm` for task state (`tm board`, `tm start <id>`, `tm done <id>`, `tm next`). Native Claude TaskCreate/TaskUpdate, Grok todo_write, and Codex update_plan calls are mirrored into the store automatically (lib/harness Bridge).",
  );
  return out.join("\n");
}

/** Self-contained brief for a subagent, worktree, or tomorrow's session. */
/**
 * How many held tasks and unmet criteria a spawned agent is told about.
 *
 * ponytail: fixed caps. This text is prepended to EVERY subagent's context, so its cost is paid
 * per fan-out — a twelve-agent sweep pays it twelve times. The WIP limit is 3 by default, so
 * three tasks covers the real case and the cap only bites on a board someone has overridden.
 */
const BRIEF_TASKS = 3;
const BRIEF_CRITERIA = 5;
/** A last-resort ceiling, in case a criterion is a paragraph. */
const BRIEF_CHARS = 1200;

/**
 * What a subagent is told when it starts.
 *
 * Claude Code fires SubagentStart with the PARENT's `session_id` and lets a hook return
 * `additionalContext`, which reaches the agent as "SubagentStart hook additional context: …".
 * Verified by spawning one against a probe hook: the agent quoted back a token that appeared
 * nowhere in its prompt.
 *
 * That makes the fan-out's blind spot fixable. A spawned agent knew nothing about the board — not
 * which task its parent was working, not what "done" meant for it — so it re-derived context the
 * parent already had, and could file a duplicate for work already tracked.
 *
 * This is NOT `handoff()`. That is a cold-start dossier — epic body, evidence, commits, branch,
 * worktree — for someone picking a task up with nothing in hand, and it ends with
 * `Resume with: tm start <id>`, which is exactly wrong advice here: the parent already holds the
 * claim. A subagent is handed its slice in the prompt. What it lacks is orientation and a
 * guardrail, and both are short.
 *
 * Returns "" when the parent holds nothing. Silence is the right output: padding every spawned
 * agent with "no tasks are claimed" costs tokens on every fan-out and tells it nothing.
 */
export function subagentBrief(session, p = paths()) {
  if (!p.root || !session) return "";
  const claims = state(p).claims || {};
  const held = Object.entries(claims)
    .filter(([, c]) => c.session === session)
    .map(([id]) => read(id, p))
    .filter(Boolean);
  if (!held.length) return "";

  const out = ["## task-management — what this session is already working on", ""];
  const shown = held.slice(0, BRIEF_TASKS);
  for (const t of shown) {
    out.push(`The parent session holds ${t.id} "${t.title}"${t.epic ? ` (${t.epic})` : ""}.`);
    const unmet = acceptanceOpen(t).slice(0, BRIEF_CRITERIA);
    if (unmet.length) {
      // Unmet only. A ticked criterion is settled; what an agent needs is the part of "done" that
      // is still outstanding.
      out.push("Not yet met:", ...unmet.map((a) => `- [ ] ${a.text}`));
    }
    out.push("");
  }
  if (held.length > shown.length) out.push(`…and ${held.length - shown.length} more claimed.`, "");

  out.push(
    // The failure this prevents: an agent decides the work is finished and records it, bypassing
    // the parent's judgement and the acceptance gate. Additive writes are fine and useful —
    // evidence and comments are how an agent reports back — so they are not forbidden.
    "The parent holds the claim, so do not run `tm start`, `tm done`, `tm park` or `tm block` on these —",
    "report what you found and let the parent record the outcome. Reads (`tm show`, `tm board`, `tm find`)",
    "and additive notes (`tm comment`, `tm evidence`) are fine.",
  );

  const text = out.join("\n");
  return text.length > BRIEF_CHARS ? `${text.slice(0, BRIEF_CHARS - 1)}…` : text;
}

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

/**
 * What changed since <iso>.
 *
 * This printed a chain of raw event kinds per task:
 *
 *   - TM-001 the task — create → update → claim → update → update → update → release → done
 *
 * which is a machine trace, not a standup. Three of those eight tokens are the word `update` and
 * none of them says what moved; `create → update → update` is not something you would say out loud.
 *
 * A standup answers three questions — what got finished, what is being worked on, and what is
 * stuck — so the report is those sections in that order, and the per-task line is the **status
 * path** rather than every event that touched the file. `collapseLog` already does the hard part:
 * it promotes a status-changing `update` to a status step and drops the ones a specific event in
 * the same second already explains, which is exactly the noise this was drowning in.
 *
 * Anything that moved no status still gets a line, because a day of comments, commits and
 * acceptance ticks is real work and dropping it would make the report lie by omission — but it goes
 * last, summarised by what those events were rather than one row each.
 */
export function standup(sinceIso, p = paths()) {
  if (!existsSync(p.events)) return "(no events yet)";
  const since = Date.parse(sinceIso);
  const rows = readEvents(p).filter((e) => e && Date.parse(e.ts) >= since);
  if (!rows.length) return `(nothing since ${sinceIso})`;

  const byId = new Map();
  for (const e of collapseLog(rows)) {
    if (!e.id) continue;
    if (!byId.has(e.id)) byId.set(e.id, []);
    byId.get(e.id).push(e);
  }

  const finished = [];
  const started = [];
  const stuck = [];
  const touched = [];

  for (const [id, events] of byId) {
    const t = read(id, p);
    // The path this entity took. collapseLog marks a status-changing update as `status` and carries
    // the value in `_status`, so the steps arrive already deduplicated.
    const path = events.filter((e) => e.event === "status" && e._status).map((e) => e._status);
    const now = t?.status;
    const line = `- ${id} ${t?.title || ""}`.trimEnd();
    const trail = path.length ? ` — ${path.join(" → ")}` : "";

    if (!t) {
      // Deleted since, or an event for an id whose file is gone. Say so, rather than printing a
      // bare id and letting the reader assume it is fine.
      touched.push(`${line} — (no longer in the store)`);
    } else if (now === "done") {
      const ac = (t.acceptance || []).length;
      finished.push(`${line}${trail}${ac ? ` (${ac} AC met)` : ""}`);
    } else if (now === "blocked" || now === "parked") {
      // The reason is what this section is for, and what a standup is for.  The status word is
      // only spelled out when the path did not already end in it, so no line reads
      // "blocked — blocked: …".
      const why = now === "blocked" ? t.blockedReason : t.parkedReason;
      const state = path.at(-1) === now ? "" : ` — ${now}`;
      stuck.push(`${line}${trail}${state} — ${why || "no reason recorded"}`);
    } else if (now === "in_progress") {
      started.push(`${line}${trail}${t.actor && t.actor !== "main" ? ` [${t.actor}]` : ""}`);
    } else {
      // No status move: say what DID happen, using the same catalog labels `tm log` renders.
      const kinds = [...new Set(events.map((e) => e.event))].filter((k) => k !== "status");
      touched.push(`${line} — ${kinds.map((k) => CATALOG.events[k]?.label || k).join(", ")}`);
    }
  }

  const out = [`# Since ${sinceIso}`, ""];
  for (const [heading, group] of [
    ["Finished", finished],
    ["In progress", started],
    ["Stuck", stuck],
    ["Also touched", touched],
  ]) {
    if (group.length) out.push(`## ${heading} (${group.length})`, ...group, "");
  }
  out.push(`${rows.length} events across ${byId.size} item(s), ${finished.length} closed.`);
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
  /**
   * Collapsed, same as `tm log <id>`. Only `renderHistory` did this, so the tail — the view you
   * actually reach for — still printed the generic `update` alongside the specific event in the
   * same second that explains it: "Any field on a task changes — patch=title" immediately above
   * "A title or body is corrected". Two rows, one action, and the uninformative one first.
   */
  for (const e of collapseLog(rows)) {
    const d = dayOf(e.ts);
    if (d !== day) {
      out.push(day ? "" : "", d);
      day = d;
    }
    const label = e.event === "status" ? `→ ${e._status}` : labels[e.event]?.label || e.event;
    const detail = e.event === "status" ? "" : eventDetail(e);
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
export function collapseLog(rows, opts = {}) {
  const specific = new Set();
  for (const e of rows) {
    if (e.event !== "update") specific.add(`${e.id || ""}@${String(e.ts).slice(0, 19)}`);
  }
  const out = [];
  /**
   * Last status seen PER ENTITY.
   *
   * This was one shared variable, so any entity's status change masked another's. With TM-001
   * going open → in_progress → done and its epic auto-closing in the same window, TM-001's `done`
   * left the tracker reading "done", so EP-001's own move to done counted as no move at all and
   * was dropped — the epic finished and the log said nothing. Interleaved work on one board is the
   * normal case, so the tracker has to be keyed by the thing whose status it is.
   */
  const status = new Map();
  for (const e of rows) {
    const key = e.id || "";
    if (e.event === "update") {
      const prior = status.get(key);
      /**
       * A transition needs the write to have actually touched `status`.
       *
       * Every `update` event carries the doc's status whether or not the write changed it, so with
       * no prior status known — a `create` records none — the first update after a create always
       * looked like a transition into `open`. Every task in the log and in the activity panel
       * carried a "→ open" row that said nothing had happened yet.
       *
       * `patch` records which fields the write actually set, so the intent is on the event rather
       * than inferred from the value: once a prior status IS known any change is a real move, and
       * before that, only a write that names `status` counts. Deliberately setting a task back to
       * open still reads as a transition, because that write patches status.
       */
      const touchedStatus = String(e.patch || "").split(",").includes("status");
      const moved = e.status && e.status !== prior && (prior !== undefined || touchedStatus);
      if (moved) {
        status.set(key, e.status);
        // Under `keep`, the row keeps its real `event` — only `_status` is added, because the
        // consumers named above match on `event`.
        out.push(opts.keep ? { ...e, _status: e.status } : { ...e, event: "status", _status: e.status });
        continue;
      }
      if (specific.has(`${key}@${String(e.ts).slice(0, 19)}`)) {
        // `keep` marks instead of dropping, for a consumer that must hand every row to somebody
        // else. The dashboard serves one events array to the activity panel AND to burndown,
        // startTimes and the PWA's notification matcher — and that matcher switches on
        // `event.event`, so rewriting an `update` into a `status` there would silently change
        // which notifications fire. One judgement, expressed two ways, rather than a second copy
        // of it that can drift.
        if (opts.keep) out.push({ ...e, _shadowed: true });
        continue;
      }
    } else if (e.status) {
      status.set(key, e.status);
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
