/**
 * Cycle-time accounting, derived entirely from the append-only event log.
 *
 * Every status change is already recorded there, so there is nothing to store
 * and nothing to keep in sync — a second set of bookkeeping fields would only
 * be a second thing to get wrong. The log is read defensively: it is appended
 * to by hooks that must never crash, so a truncated line is normal and gets
 * dropped rather than throwing.
 *
 * Durations are honest about gaps. A task started, parked overnight and picked
 * up again took the time it was in progress, not the wall clock since it was
 * first touched.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { paths } from "./paths.mjs";
import { kindOf } from "./store.mjs";

/** The only status you stop accruing time in. Everything else is still ageing. */
const TERMINAL = "done";

/** Every event in the log, oldest first — including rotated `events.N.jsonl` files. */
export function readEvents(p = paths()) {
  if (!p.events) return [];
  const dir = dirname(p.events);
  if (!existsSync(dir)) return [];
  const rows = [];
  for (const f of readdirSync(dir).filter((f) => /^events(\.\d+)?\.jsonl$/.test(f))) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e && Number.isFinite(Date.parse(e.ts))) rows.push(e);
      } catch {
        /* a half-written line is expected; skip it */
      }
    }
  }
  return rows.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/** One task's events, oldest first. */
export function taskTimeline(id, p = paths()) {
  return readEvents(p).filter((e) => e.id === id);
}

/**
 * The statuses a task passed through, as `{status, from, to}` in ms.
 * `create` means "open" — the first status nothing bothers to log explicitly.
 * The final span runs to `now` unless the task is done.
 */
function spans(id, p, now) {
  const marks = [];
  for (const e of taskTimeline(id, p)) {
    const status = e.status || (e.event === "create" ? "open" : null);
    if (!status || marks.at(-1)?.status === status) continue;
    marks.push({ status, at: Date.parse(e.ts) });
  }
  return marks.map((m, i) => ({
    status: m.status,
    from: m.at,
    to: marks[i + 1]?.at ?? (m.status === TERMINAL ? m.at : now),
  }));
}

/** Milliseconds spent in each status the task actually sat in. */
export function timeInStatus(id, p = paths(), now = Date.now()) {
  const out = {};
  for (const s of spans(id, p, now)) out[s.status] = (out[s.status] || 0) + (s.to - s.from);
  return out;
}

/**
 * First `in_progress` → `done`. `ms` is time actually in progress; `elapsedMs`
 * is the wall clock between those two points, which is only the same number
 * when nothing interrupted the task. Null while the task is still open.
 */
export function cycleTime(id, p = paths()) {
  const all = spans(id, p, Date.now());
  const started = all.find((s) => s.status === "in_progress");
  const done = all.filter((s) => s.status === TERMINAL).at(-1);
  if (!started || !done) return null;
  const ms = all
    .filter((s) => s.status === "in_progress" && s.from < done.from)
    .reduce((sum, s) => sum + Math.min(s.to, done.from) - s.from, 0);
  return {
    startedAt: new Date(started.from).toISOString(),
    doneAt: new Date(done.from).toISOString(),
    ms,
    elapsedMs: done.from - started.from,
    human: human(ms),
  };
}

/** Tasks closed per calendar day (UTC), since `sinceIso` if given. */
export function throughput(p = paths(), { sinceIso } = {}) {
  const since = sinceIso ? Date.parse(sinceIso) : -Infinity;
  const closed = new Map();
  for (const e of readEvents(p)) {
    if (!e.id || closed.has(e.id)) continue;
    if (e.event === "done" || e.status === TERMINAL) closed.set(e.id, Date.parse(e.ts));
  }
  const times = [...closed.values()].filter((t) => t >= since).sort((a, b) => a - b);
  const byDay = {};
  for (const t of times) {
    const day = new Date(t).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
  }
  const DAY = 86_400_000;
  const from = Number.isFinite(since) ? since : times[0];
  const days = times.length ? Math.max(1, Math.ceil((times.at(-1) - from) / DAY) || 1) : 0;
  return { byDay, total: times.length, perDay: days ? times.length / days : 0 };
}

/** Median/mean cycle time, current WIP ages, and the oldest thing still open. */
export function summary(p = paths(), now = Date.now()) {
  const first = new Map();
  for (const e of readEvents(p)) {
    if (kindOf(e.id) === "task" && !first.has(e.id)) first.set(e.id, Date.parse(e.ts));
  }

  const cycles = [];
  const wip = [];
  let oldestOpen = null;
  for (const [id, created] of first) {
    const cycle = cycleTime(id, p);
    if (cycle) {
      cycles.push(cycle.ms);
      continue;
    }
    const current = spans(id, p, now).at(-1);
    if (current?.status === "in_progress") wip.push({ id, ms: now - current.from, human: human(now - current.from) });
    if (!oldestOpen || created < oldestOpen.created) oldestOpen = { id, created, ms: now - created, human: human(now - created) };
  }

  cycles.sort((a, b) => a - b);
  const mid = Math.floor(cycles.length / 2);
  const medianMs = !cycles.length ? 0 : cycles.length % 2 ? cycles[mid] : (cycles[mid - 1] + cycles[mid]) / 2;
  const meanMs = cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : 0;

  return {
    completed: cycles.length,
    medianMs,
    meanMs,
    median: human(medianMs),
    mean: human(meanMs),
    wip: wip.sort((a, b) => b.ms - a.ms),
    oldestOpen: oldestOpen && { id: oldestOpen.id, ms: oldestOpen.ms, human: oldestOpen.human },
  };
}

/** Durations a human reads at a glance: "45s", "20m", "2h 20m", "3d 4h". */
export function human(ms) {
  if (!(ms > 0)) return "0m";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(ms / 3_600_000);
  if (h < 24) return [`${h}h`, m % 60 && `${m % 60}m`].filter(Boolean).join(" ");
  return [`${Math.floor(h / 24)}d`, h % 24 && `${h % 24}h`].filter(Boolean).join(" ");
}
