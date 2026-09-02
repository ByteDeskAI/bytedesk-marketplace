/**
 * pool: the dispatcher loop that turns the board into an agent-first pickup system.
 *
 * A task labelled `ready-for-agent` is work a human has finished specifying and a
 * worker can take without a conversation. The pool is the thing that notices:
 * every tick it collects the results of workers that finished (collect.mjs is the
 * single write path for that), then dispatches the queue's ready tasks up to
 * `dispatch.poolWip` (default 3), preferring the touches-disjoint set so two
 * workers never start on colliding paths in the same tick.
 *
 * Two entry points, deliberately different policies:
 *
 *   VERBS   `tm pool once|start|stop|status` are explicit control — a human (or a
 *           script a human wrote) asked, so the tick runs. The kill-switches
 *           still apply: TM_ENFORCE=off or `dispatch.enabled: false` in config
 *           means the tick reports { disabled: true } and dispatches nothing.
 *
 *   MONITOR the `tm-pool` monitor autostarts `tm pool run --auto` with the
 *           plugin. An autostarted daemon nobody asked for must not start
 *           dispatching work, so --auto is opt-in: unless the store's config
 *           sets `dispatch.enabled: true` the loop exits 0 immediately. The
 *           verbs above work regardless — explicit beats config.
 *
 * Config (all under `dispatch`, set with `tm config dispatch '{...}'`):
 *   enabled       false is a kill-switch for the tick; the monitor also requires true
 *   poolWip       max pool-spawned workers at once (default 3)
 *   pollSeconds   seconds between ticks of `tm pool run` (default 30)
 *
 * Dispatch goes through ./index.mjs `dispatch()` only — claim, start, provision,
 * spawn all keep their one implementation, and a refused dispatch leaves the
 * board exactly as the tick found it. The loop never holds the store lock across
 * a sleep: withLock is per-write inside the store, and the inter-tick sleep
 * happens after the tick has fully returned.
 *
 * One pool per store: `pool.pid` in the store root follows the same discipline
 * as lib/singleton.mjs's dashboard.pid — the record carries the store path, so a
 * recycled pid from an unrelated process is never mistaken for a live pool, and
 * the file is in the store's gitignore contract (it is one machine's runtime
 * state, like agents.json).
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claimant } from "../claims.mjs";
import { listAgents, retireAgent } from "../agents.mjs";
import { batches } from "../parallel.mjs";
import { config, list, nextTasks, read } from "../store.mjs";
import { paths } from "../paths.mjs";
import { dispatch } from "./index.mjs";
import { collect } from "./collect.mjs";
import { resolveBackend } from "./backend.mjs";

/** The label that says "a worker can take this without a conversation". */
export const READY_LABEL = "ready-for-agent";

// ── pool.pid: one loop per store ─────────────────────────────────────────────

const pidFile = (p) => join(p.base, "pool.pid");

/** The recorded pool instance, or null when there is no readable one. */
export function readPoolPid(p = paths()) {
  try {
    const inst = JSON.parse(readFileSync(pidFile(p), "utf8"));
    if (!Number.isInteger(inst?.pid) || inst.pid <= 0) return null;
    return { ...inst, store: inst.store ?? p.base };
  } catch {
    return null;
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // running, just not ours to signal
  }
};

/**
 * The pool actually serving this store right now, or null. The store path in
 * the record must match — same guard as singleton.mjs's liveInstance, so a pid
 * the OS handed to someone else after a crash is not "our pool".
 */
export function livePool(p = paths()) {
  const inst = readPoolPid(p);
  if (!inst || inst.store !== p.base) return null;
  return alive(inst.pid) ? inst : null;
}

export function writePoolPid(p = paths()) {
  const record = { pid: process.pid, store: p.base, started: new Date().toISOString() };
  writeFileSync(pidFile(p), `${JSON.stringify(record)}\n`);
  return record;
}

/** Remove the pid file. Safe when nothing is running. */
export function releasePoolPid(p = paths()) {
  try {
    if (existsSync(pidFile(p))) unlinkSync(pidFile(p));
  } catch {
    /* ignore */
  }
}

/** SIGTERM the recorded pool. Returns the instance it signalled, or null. */
export function stopPool(p = paths()) {
  const inst = livePool(p);
  if (inst && inst.pid !== process.pid) {
    try {
      process.kill(inst.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  if (readPoolPid(p)?.store === p.base && !livePool(p)) releasePoolPid(p);
  return inst;
}

// ── the tick ─────────────────────────────────────────────────────────────────

/**
 * The pickup queue: startable tasks labelled ready-for-agent that nobody holds,
 * in `nextTasks` queue order (rank, then priority, then id). nextTasks already
 * excludes blocked and resolved work; claimant excludes live claims.
 */
export function poolable(p = paths()) {
  return nextTasks(p).filter((t) => (t.labels || []).includes(READY_LABEL) && !claimant(t.id, p));
}

/**
 * One pass of the loop: collect finished workers, then dispatch into the freed
 * capacity. Never throws per item — one bad task lands in `skipped` with its
 * reason and cannot kill the tick.
 *
 *   p          store paths
 *   registry   injectable backend registry (tests; TM_DISPATCH_REGISTRY reaches
 *              the CLI the same way through envRegistry)
 *   caps       injectable host capabilities (tests)
 *   dryRun     report what would dispatch, change nothing
 *   impls      collector routing overrides, passed through to collect()
 *   env        where TM_ENFORCE is read (tests)
 *
 * Returns { collected, dispatched, skipped, capacity } — or
 * { disabled: true, reason, ...empty } when a kill-switch fired before any work.
 */
export async function poolTick({ p = paths(), registry = null, caps = null, dryRun = false, impls = {}, env = process.env } = {}) {
  const empty = { collected: [], dispatched: [], skipped: [], capacity: 0 };
  if (String(env.TM_ENFORCE || "").toLowerCase() === "off") {
    return { disabled: true, reason: "TM_ENFORCE=off", ...empty };
  }
  const cfg = config(p);
  if (cfg.dispatch?.enabled === false) {
    return { disabled: true, reason: "config dispatch.enabled is false", ...empty };
  }

  const collected = [];
  const dispatched = [];
  const skipped = [];

  /**
   * Collection first: a worker that finished frees its capacity and parks its
   * failures BEFORE the tick decides what to start — otherwise a parked task's
   * dead worker still reads as an alive agent and the pool thinks it is full.
   * A task whose worker is still running collects as { pending: true }: a read,
   * not a wait.
   */
  for (const t of list("task", { status: "in_progress" }, p)) {
    if (!t.dispatched) continue;
    try {
      const res = await collect(t.id, p, impls);
      collected.push({ id: t.id, ...res });
      // A terminal result retires the worker's registry entry, so the capacity
      // count below does not charge this tick for a worker that already ended.
      if (res.ok && !res.pending) {
        const run = read(t.id, p)?.dispatched?.run;
        const agent = run ? listAgents(p).find((a) => a.runId && a.runId === run) : null;
        if (agent) retireAgent(agent.name, p);
      }
    } catch (err) {
      skipped.push({ id: t.id, reason: `collect failed: ${err.message}` });
    }
  }

  // Pool-spawned workers only: a registered agent with a backend is a dispatch;
  // backend null is an interactive session and does not consume pool WIP.
  const aliveWorkers = listAgents(p).filter((a) => a.alive && a.backend != null);
  const busy = aliveWorkers.length;
  const capacity = Math.max(0, Number(cfg.dispatch?.poolWip ?? 3) - busy);

  // Per-backend caps (config dispatch.backendCaps, e.g. { tmux: 2 }) sit on top of
  // poolWip: a capped backend skips its candidates even when the pool has room.
  const busyByBackend = {};
  for (const a of aliveWorkers) busyByBackend[a.backend] = (busyByBackend[a.backend] || 0) + 1;
  const pick = dryRun ? null : await resolveBackend({ caps, registry, p });
  const backendCap = pick?.name ? Number(cfg.dispatch?.backendCaps?.[pick.name]) : NaN;

  /**
   * The collision-free set. batches() bins the startable queue by disjoint
   * touches; the first bin is the maximal greedy set that can all run at once,
   * so a ready task that landed in a later bin collides with something ahead of
   * it and waits for the next tick.
   */
  const collisionFree = new Set((batches({}, p)[0]?.tasks || []).map((t) => t.id));

  let room = capacity;
  for (const task of poolable(p)) {
    if (room <= 0) {
      skipped.push({ id: task.id, reason: "at capacity" });
      continue;
    }
    if (!collisionFree.has(task.id)) {
      skipped.push({ id: task.id, reason: "touches collide with a task ahead of it" });
      continue;
    }
    if (dryRun) {
      dispatched.push({ id: task.id, dryRun: true });
      room -= 1;
      continue;
    }
    try {
      // One session per dispatch, so a reaped worker parks its own task and not
      // every task the pool is running (reapDeadWorkers maps claims by session).
      if (Number.isFinite(backendCap) && (busyByBackend[pick.name] || 0) >= backendCap) {
        skipped.push({ id: task.id, reason: `backend ${pick.name} at cap (${backendCap})` });
        continue;
      }
      const res = await dispatch(task.id, { session: `pool-${task.id.toLowerCase()}`, actor: "pool", p, caps, registry, backend: pick?.name ?? null });
      if (res.ok) {
        dispatched.push({ id: task.id, backend: res.backend, run: res.run ?? null, worktree: res.worktree });
        busyByBackend[res.backend] = (busyByBackend[res.backend] || 0) + 1;
        room -= 1;
      } else {
        skipped.push({ id: task.id, reason: res.reason });
      }
    } catch (err) {
      skipped.push({ id: task.id, reason: `dispatch failed: ${err.message}` });
    }
  }

  return { collected, dispatched, skipped, capacity };
}

// ── the loop ─────────────────────────────────────────────────────────────────

/**
 * The daemon: tick, sleep `dispatch.pollSeconds` (default 30), repeat.
 *
 * `auto` is the monitor entry point: an autostarted pool is opt-in, so unless
 * config sets dispatch.enabled === true this returns { disabled } immediately —
 * exit 0, no pid file, no tick. `tm pool start` (explicit) runs without `auto`.
 *
 * Refuses to start a second pool over a live pid file, writes pool.pid on
 * start, and removes it on SIGTERM/SIGINT — the sleep is interruptible so a
 * stop lands within a tick, not after a full poll interval.
 */
export async function runPool({ p = paths(), auto = false, intervalSeconds = null, registry = null, caps = null, onTick = null } = {}) {
  if (auto && config(p).dispatch?.enabled !== true) {
    return { disabled: true, reason: 'config dispatch.enabled is not true — the pool daemon is opt-in (tm config dispatch \'{"enabled":true}\')' };
  }
  const incumbent = livePool(p);
  if (incumbent && incumbent.pid !== process.pid) {
    return { ok: false, reason: `pool already running (pid ${incumbent.pid}, started ${incumbent.started || "?"})` };
  }
  writePoolPid(p);

  const seconds = intervalSeconds ?? Number(config(p).dispatch?.pollSeconds ?? 30);
  let wake = null;
  const stop = () => {
    if (wake) wake();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  let stopped = false;
  try {
    for (;;) {
      const tick = await poolTick({ p, registry, caps });
      if (onTick) onTick(tick);
      // The lock is never held here: the tick has fully returned before the
      // sleep starts, and withLock scopes itself to single writes regardless.
      if (!(seconds > 0)) break;
      const interrupted = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), seconds * 1000);
        wake = () => {
          clearTimeout(timer);
          resolve(true);
        };
      });
      wake = null;
      if (interrupted) {
        stopped = true;
        break;
      }
    }
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    releasePoolPid(p);
  }
  return { ok: true, stopped };
}
