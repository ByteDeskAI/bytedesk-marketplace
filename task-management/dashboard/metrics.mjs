/**
 * Board arithmetic. Pure — the page renders, this module decides what the
 * numbers are, and node:test can check them without a browser.
 *
 * Everything here works off what the store already records: index.json for the
 * cards, events.jsonl for when they moved.
 */
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const time = (v) => {
  const t = Date.parse(v ?? "");
  return Number.isNaN(t) ? null : t;
};

export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Coarse on purpose: two units is all a card has room for. */
export function fmtDuration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  const m = Math.floor((ms % HOUR) / MIN);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/** How long the card has sat where it is — `updated` is stamped on every move. */
export function elapsed(task, now = Date.now()) {
  const at = time(task.updated) ?? time(task.created);
  return at === null ? null : Math.max(0, now - at);
}

/** id → first move into in_progress. Re-starts after a block don't reset the clock. */
export function startTimes(events = []) {
  const starts = new Map();
  for (const e of events) {
    if (e?.status !== "in_progress" || !e.id) continue;
    const at = time(e.ts);
    if (at !== null && !starts.has(e.id)) starts.set(e.id, at);
  }
  return starts;
}

/** start → done, for finished cards only. Creation stands in for an unrecorded start. */
export function cycleTime(task, starts = new Map()) {
  if (task.status !== "done") return null;
  const end = time(task.closed) ?? time(task.updated);
  const begin = starts.get(task.id) ?? time(task.created);
  if (end === null || begin === null) return null;
  return Math.max(0, end - begin);
}

/** Who is holding this card right now, if anyone. */
export function claim(task) {
  if (task.status !== "in_progress") return null;
  const worktree = task.worktree ? String(task.worktree).split("/").filter(Boolean).pop() : null;
  const session = task.session ? String(task.session).slice(0, 6) : null;
  if (!worktree && !session && !task.branch) return null;
  return { session, branch: task.branch || null, worktree: worktree || null };
}

/**
 * Remaining open work per day, walked backwards from today's real count through
 * the done/create events. Oldest first, one point per day.
 *
 * ponytail: a card created and closed before the window simply never appears —
 * good enough for a sparkline, and it can't drift from today's true count.
 *
 * @param {any[]} tasks
 * @param {any[]} events
 * @param {{ days?: number, now?: number, epic?: string | null }} [opts]
 */
export function burndown(tasks = [], events = [], opts = {}) {
  const { days = 14, now = Date.now(), epic } = opts;
  const mine = tasks.filter((t) => (epic ? t.epic === epic : true));
  const ids = new Set(mine.map((t) => t.id));
  const perDay = new Map();
  // One closure per card: the store logs `done` *and* an `update` carrying status
  // done, so counting events would inflate throughput several times over.
  const counted = { done: new Set(), created: new Set() };
  for (const e of events) {
    const at = time(e?.ts);
    if (at === null || !ids.has(e.id)) continue;
    const kind = e.event === "done" || e.status === "done" ? "done" : e.event === "create" ? "created" : null;
    if (!kind || counted[kind].has(e.id)) continue;
    counted[kind].add(e.id);
    const bucket = perDay.get(dayKey(at)) || { done: 0, created: 0 };
    bucket[kind] += 1;
    perDay.set(dayKey(at), bucket);
  }

  const open = mine.filter((t) => t.status !== "done" && t.status !== "deleted").length;
  const series = [];
  let remaining = open;
  for (let i = 0; i < days; i += 1) {
    const day = dayKey(now - i * DAY);
    const { done = 0, created = 0 } = perDay.get(day) || {};
    series.unshift({ day, remaining, done });
    remaining = Math.max(0, remaining + done - created);
  }
  return series;
}
