/**
 * pool: the dispatcher loop that turns the board into an agent-first pickup system.
 *
 * A task labelled `ready-for-agent` is work a human has finished specifying and a
 * worker can take without a conversation. The pool is the thing that notices:
 * every tick it collects the results of workers that finished (collect.mjs is the
 * single write path for that), then dispatches the queue's ready tasks up to
 * `dispatch.poolWip` (default 3), preferring the touches-disjoint set so two
 * workers never start on colliding paths in the same tick. A labelled task must
 * still pass completeness.mjs `agentReadiness` — the same check the store's label
 * sync uses — or the tick skips it with the missing fields named (TM-178 B3).
 *
 * On by default (TM-178). `poolEnabled(cfg)` is the one test of the switch: the
 * pool is on unless config sets `dispatch.enabled: false`.
 *
 *   VERBS   `tm pool once|start|stop|status|resume` are explicit control. The
 *           kill-switches still apply: TM_ENFORCE=off or `dispatch.enabled: false`
 *           means the tick reports { disabled: true } and dispatches nothing.
 *
 *   ENSURE  `ensurePool` is how a session asks for a pool WITHOUT becoming one: with no live
 *           pool it spawns `tm pool run` detached, in its own process group, with the asking
 *           session's identity stripped from the child's environment, and returns. One pool
 *           per repo, out of band from every session — a second session costs nothing, and
 *           closing the session that started it changes nothing. The monitor, the user-prompt
 *           hook, `tm config dispatch.*` and the dashboard's settings save all simply ensure.
 *
 *   RUN     `tm pool run` is that pool: a plain foreground loop. It claims pool.pid or refuses
 *           with exit 2, re-reads config every poll so `enabled: false` stops it within one
 *           poll, exits after `idleExitMinutes` with nothing to do, and prints one line per
 *           state change — to pool.log when ensurePool started it.
 *
 * Config (all under `dispatch`, set with `tm config dispatch.<key> <value>`):
 *   enabled            default true; false is the kill switch for the tick and the loop
 *   idleExitMinutes    exit with no workers and nothing to pick up for this long (default 60; 0 never)
 *   poolWip            max dispatched tasks in progress at once (default 3)
 *   pollSeconds        seconds between ticks of `tm pool run` (default 30)
 *   maxFailures        consecutive failures before the pool pauses (default 3)
 *   maxRuntimeMinutes  a still-running worker older than this logs worker_overrun (default 120)
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
 * state, like agents.json). `pool.state.json` beside it is the brake: the failure
 * count and the pause, which must outlive the process that set them.
 */
import { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SESSION_ENV } from "../harness/sessions.mjs";
import { claimant } from "../claims.mjs";
import { listAgents, retireAgent } from "../agents.mjs";
import { batches } from "../parallel.mjs";
import { config, list, logEvent, nextTasks, now, read, withLock } from "../store.mjs";
import { agentReadiness } from "../completeness.mjs";
import { paths } from "../paths.mjs";
import { dispatch } from "./index.mjs";
import { collect } from "./collect.mjs";
import { resolveBackend } from "./backend.mjs";

/** The label that says "a worker can take this without a conversation". */
export const READY_LABEL = "ready-for-agent";

/** The one test of the on switch, for the loop, the tick and `tm pool status`: on unless explicitly false. */
export const poolEnabled = (cfg) => cfg?.dispatch?.enabled !== false;

/** Where a detached pool's stream goes. Truncated by each start, so it cannot grow without bound. */
export const poolLogFile = (p = paths()) => join(p.base, "pool.log");

/** This plugin's own CLI — the pool is `tm pool run`, resolved from here rather than from argv. */
const TM_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "tm");

/**
 * The detached pool must not inherit the identity of whoever happened to ask for it.
 *
 * A pool started from a worker's shell would otherwise claim, stamp and gate as that worker:
 * `actor()` reads TM_ACTOR / CLAUDE_AGENT_NAME, `sessionId()` walks SESSION_ENV, and the
 * worker-guard variables would make the pool look like a dispatched worker to its own hook.
 * TM_ROOT stays — that is which store to serve, not who is asking — and TMUX is blanked so no
 * inherited server can be addressed.
 */
const IDENTITY_ENV = ["TM_ACTOR", "TM_ACTOR_INFER", "CLAUDE_AGENT_NAME", "CLAUDE_CODE_CHILD_SESSION", "TM_DISPATCH_WORKER", "TM_DISPATCH_TASK", "TM_DISPATCH_BRANCH", ...SESSION_ENV];

function poolEnv(env, p) {
  const next = { ...env, TM_ROOT: p.root, TMUX: "" };
  for (const key of IDENTITY_ENV) delete next[key];
  return next;
}

/**
 * Make sure this repo has a pool, without becoming one: `{ action: "off" | "running" | "started", pid }`.
 *
 * The session asking is a client, not a host. It spawns the loop detached, in its own process
 * group, unref'd, so the pool survives the session, the terminal and the monitor that asked —
 * one pool per repo rather than one per session.
 *
 * Two ensures racing is fine and deliberately not locked: both may spawn, `wx` inside
 * writePoolPid lets exactly one claim pool.pid, and the loser's `run` exits 2 on its own. The log
 * is truncated only on the spawn path (no live pool, so nobody is writing), and the loser can only
 * append its one-line refusal.
 */
export function ensurePool(p = paths(), { spawnImpl = spawn, env = process.env } = {}) {
  if (!poolEnabled(config(p))) return { action: "off", pid: null };
  const inst = livePool(p);
  if (inst) return { action: "running", pid: inst.pid };

  let stdio = ["ignore", "ignore", "ignore"];
  let fd = null;
  try {
    writeFileSync(poolLogFile(p), "");
    fd = openSync(poolLogFile(p), "a");
    stdio = ["ignore", fd, fd];
  } catch {
    /* a log we cannot write is not a reason to go without a pool */
  }
  try {
    const child = spawnImpl(process.execPath, [TM_BIN, "pool", "run"], { cwd: p.root, detached: true, stdio, env: poolEnv(env, p) });
    child.unref?.();
    return { action: "started", pid: child.pid ?? null };
  } finally {
    if (fd !== null) closeSync(fd); // the child holds its own copy
  }
}

// ── pool.pid: one loop per store ─────────────────────────────────────────────

const pidFile = (p) => join(p.base, "pool.pid");

/** Stores whose pool.pid THIS process wrote and still holds (a same-pid record is otherwise a recycled pid). */
const held = new Set();

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

/**
 * Take pool.pid for this process: `{ ok: true, record }`, or `{ ok: false, incumbent }`.
 *
 * Check-then-write let two loops that started together both see no pool and both
 * run (TM-175 B8). The file is now created with `wx`, which fails if it exists, and
 * the whole decision runs under the store lock, so a stale record (dead pid, another
 * store's path) is replaced by exactly one claimant. A record carrying our own pid is
 * an incumbent only when this process really holds it — otherwise it is a crashed
 * predecessor whose pid the OS recycled to us.
 */
export function writePoolPid(p = paths()) {
  const record = { pid: process.pid, store: p.base, started: now() };
  const body = `${JSON.stringify(record)}\n`;
  return withLock(p, () => {
    try {
      writeFileSync(pidFile(p), body, { flag: "wx" });
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const incumbent = livePool(p);
      if (incumbent && (incumbent.pid !== process.pid || held.has(p.base))) return { ok: false, incumbent };
      writeFileSync(pidFile(p), body); // stale: replaced under the lock every claimant takes
    }
    held.add(p.base);
    return { ok: true, record };
  });
}

/** Remove the pid file. Safe when nothing is running. */
export function releasePoolPid(p = paths()) {
  held.delete(p.base);
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

// ── pool.state.json: the brake ───────────────────────────────────────────────

const stateFile = (p) => join(p.base, "pool.state.json");

/** A failure whose reason says the harness is out of budget: retrying cannot help, so one pauses. */
export const QUOTA_RE = /usage limit|rate limit|quota|reached your .*limit|\b429\b/i;

const CLEAR = { failures: 0, changedAt: null, pausedReason: null, pausedAt: null };

/** The brake as it is on disk. A missing or torn file is an unbraked pool. */
export function readPoolState(p = paths()) {
  try {
    const s = JSON.parse(readFileSync(stateFile(p), "utf8"));
    return { ...CLEAR, ...s, failures: Number(s.failures) || 0 };
  } catch {
    return { ...CLEAR };
  }
}

/**
 * Written through a rename so a crash mid-write cannot tear the pause away. The temp
 * name matches the store's existing `.tm-tmp-*` ignore rule. Every read-modify-write of
 * this file runs under withLock, so a `tm pool resume` cannot be lost to a failure the
 * running loop records at the same moment.
 */
function writePoolState(next, p) {
  const tmp = join(p.base, `.tm-tmp-pool-state-${process.pid}`);
  writeFileSync(tmp, `${JSON.stringify(next)}\n`);
  renameSync(tmp, stateFile(p));
  return next;
}

/** `tm pool resume`: clear the pause and the count. Returns the state it cleared. */
export function resumePool(p = paths()) {
  return withLock(p, () => {
    const prior = readPoolState(p);
    writePoolState({ ...CLEAR, changedAt: now() }, p);
    return prior;
  });
}

/**
 * Count one failure; pause at dispatch.maxFailures, or at once for a quota-shaped one.
 * Returns the state after. A pool already paused stays paused and stops counting.
 */
function recordFailure(reason, cfg, p) {
  const paused = withLock(p, () => {
    const s = readPoolState(p);
    if (s.pausedReason) return { state: s, logged: null };
    const text = String(reason || "unknown failure");
    const brief = text.split("\n")[0].slice(0, 300);
    const at = now();
    const failures = s.failures + 1;
    const next = { ...s, failures, changedAt: at };
    const quota = QUOTA_RE.test(text);
    if (quota || failures >= Number(cfg.dispatch?.maxFailures ?? 3)) {
      next.pausedReason = quota ? `quota-shaped failure: ${brief}` : `${failures} consecutive failures (last: ${brief})`;
      next.pausedAt = at;
    }
    return { state: writePoolState(next, p), logged: next.pausedReason ? { reason: next.pausedReason, failures } : null };
  });
  // Logged outside the lock: logEvent fans out to notifiers, which must not run while the store is held.
  if (paused.logged) logEvent("pool_paused", paused.logged, p);
  return paused.state;
}

/**
 * The success that ends a streak: a dispatched task that closed after the count last
 * changed. Read from the board — `tm done` stamps `closed` — rather than from collect,
 * because the pool only collects in_progress tasks and a worker that closed through
 * the gates is no longer one. A pause is not lifted here; only `tm pool resume` does.
 * ponytail: scans every done task each tick; index by `closed` if boards reach thousands.
 */
function resetOnClose(p) {
  const s = readPoolState(p);
  if (!s.failures || s.pausedReason || !s.changedAt) return;
  const since = new Date(s.changedAt).getTime();
  const closed = list("task", { status: "done" }, p).some((t) => t.dispatched && t.closed && new Date(t.closed).getTime() > since);
  if (!closed) return;
  // The scan stays outside the lock; the write resets only the streak that was scanned. A
  // failure or resume recorded meanwhile moved changedAt, and that newer state wins.
  withLock(p, () => {
    const current = readPoolState(p);
    if (current.changedAt === s.changedAt && !current.pausedReason) writePoolState({ ...current, failures: 0, changedAt: now() }, p);
  });
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
 * The workers the pool is charged for: in_progress tasks with a dispatch record.
 *
 * Counted from the board, not the agent registry (TM-175 B4). tmux and topology
 * spawns register `pid: null` and nothing renews their heartbeat, so after
 * agentTtlMinutes a running worker read dead and the pool overfilled poolWip. The
 * board is the truth the collector maintains: a worker that ended is parked or done.
 */
export function poolWorkers(p = paths()) {
  return list("task", { status: "in_progress" }, p).filter((t) => t.dispatched);
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
 * Returns { collected, dispatched, skipped, capacity, paused? } — or
 * { disabled: true, reason, ...empty } when a kill-switch fired before any work.
 */
export async function poolTick({ p = paths(), registry = null, caps = null, dryRun = false, impls = {}, env = process.env } = {}) {
  const empty = { collected: [], dispatched: [], skipped: [], capacity: 0 };
  if (String(env.TM_ENFORCE || "").toLowerCase() === "off") {
    return { disabled: true, reason: "TM_ENFORCE=off", ...empty };
  }
  const cfg = config(p);
  if (!poolEnabled(cfg)) {
    return { disabled: true, reason: "config dispatch.enabled is false", ...empty };
  }

  const collected = [];
  const dispatched = [];
  const skipped = [];

  resetOnClose(p);

  /**
   * Collection first: a worker that finished frees its capacity and parks its
   * failures BEFORE the tick decides what to start. A task whose worker is still
   * running collects as { pending: true }: a read, not a wait, and neither a
   * failure nor a success for the brake. A paused pool still collects.
   */
  for (const t of list("task", { status: "in_progress" }, p)) {
    if (!t.dispatched) continue;
    try {
      const res = await collect(t.id, p, impls);
      collected.push({ id: t.id, ...res });
      if (res.ok && !res.pending) {
        // Registry hygiene only — capacity is read from the board below.
        const run = read(t.id, p)?.dispatched?.run;
        const agent = run ? listAgents(p).find((a) => a.runId && a.runId === run) : null;
        if (agent) retireAgent(agent.name, p);
        if (res.outcome === "failed") recordFailure(`${t.id}: ${res.summary || "worker failed"}`, cfg, p);
      }
    } catch (err) {
      skipped.push({ id: t.id, reason: `collect failed: ${err.message}` });
    }
  }

  const running = list("task", { status: "in_progress" }, p);
  const workers = running.filter((t) => t.dispatched);
  const capacity = Math.max(0, Number(cfg.dispatch?.poolWip ?? 3) - workers.length);

  // Per-backend caps (config dispatch.backendCaps, e.g. { tmux: 2 }) sit on top of
  // poolWip, charged by the backend each running task was dispatched to.
  const busyByBackend = {};
  for (const t of workers) busyByBackend[t.dispatched.backend] = (busyByBackend[t.dispatched.backend] || 0) + 1;
  const pick = dryRun ? null : await resolveBackend({ caps, registry, p });
  const backendCap = pick?.name ? Number(cfg.dispatch?.backendCaps?.[pick.name]) : NaN;

  /**
   * The collision-free set. batches() bins the startable queue by disjoint
   * touches; the first bin is the maximal greedy set that can all run at once,
   * so a ready task that landed in a later bin collides with something ahead of
   * it and waits for the next tick. batches() only sees open work, so the paths
   * running tasks hold are checked separately (TM-175 B6).
   */
  const collisionFree = new Set((batches({}, p)[0]?.tasks || []).map((t) => t.id));
  const occupiedBy = new Map();
  for (const t of running) for (const path of t.touches || []) if (!occupiedBy.has(path)) occupiedBy.set(path, t.id);

  let brake = readPoolState(p);
  let room = capacity;
  for (const task of poolable(p)) {
    // The label can be a person's hand-set call, so the pool still asks the one readiness check (B3).
    // A skip, not a failure: nothing was attempted, so the brake does not count it.
    const { ready, missing } = agentReadiness(task, cfg);
    if (!ready) {
      skipped.push({ id: task.id, reason: `not ready: ${missing.join(", ")}` });
      continue;
    }
    if (brake.pausedReason) {
      skipped.push({ id: task.id, reason: `pool paused: ${brake.pausedReason} — tm pool resume` });
      continue;
    }
    if (room <= 0) {
      skipped.push({ id: task.id, reason: "at capacity" });
      continue;
    }
    if (!collisionFree.has(task.id)) {
      skipped.push({ id: task.id, reason: "touches collide with a task ahead of it" });
      continue;
    }
    const taken = (task.touches || []).find((path) => occupiedBy.has(path));
    if (taken) {
      skipped.push({ id: task.id, reason: `touches overlap in_progress ${occupiedBy.get(taken)} (${taken})` });
      continue;
    }
    if (dryRun) {
      dispatched.push({ id: task.id, dryRun: true });
      room -= 1;
      continue;
    }
    if (Number.isFinite(backendCap) && (busyByBackend[pick.name] || 0) >= backendCap) {
      skipped.push({ id: task.id, reason: `backend ${pick.name} at cap (${backendCap})` });
      continue;
    }
    let failure = null;
    try {
      // One session per dispatch, so a reaped worker parks its own task and not
      // every task the pool is running (reapDeadWorkers maps claims by session).
      const res = await dispatch(task.id, { session: `pool-${task.id.toLowerCase()}`, actor: "pool", p, caps, registry, backend: pick?.name ?? null });
      if (res.ok) {
        dispatched.push({ id: task.id, backend: res.backend, run: res.run ?? null, worktree: res.worktree });
        busyByBackend[res.backend] = (busyByBackend[res.backend] || 0) + 1;
        room -= 1;
      } else {
        failure = res.reason;
      }
    } catch (err) {
      failure = `dispatch failed: ${err.message}`;
    }
    if (failure !== null) {
      skipped.push({ id: task.id, reason: failure });
      brake = recordFailure(`${task.id}: ${failure}`, cfg, p);
    }
  }

  brake = readPoolState(p);
  return { collected, dispatched, skipped, capacity, ...(brake.pausedReason ? { paused: { reason: brake.pausedReason, at: brake.pausedAt } } : {}) };
}

// ── the loop ─────────────────────────────────────────────────────────────────

/**
 * The daemon: tick, sleep `dispatch.pollSeconds` (default 30), repeat — re-reading config at the
 * top of every poll, so the on switch is live (TM-178).
 *
 *   disabled  poolEnabled false ends the loop at the top of any poll: at launch before any pid
 *             file or tick, mid-run by releasing pool.pid and stopping.
 *   running   pool.pid is taken through writePoolPid (exclusive; a stale record is replaced
 *             under the lock) and removed on the way out. A live incumbent is a refusal,
 *             { ok: false, reason } — one pool per store, and `ensurePool` is how you get it.
 *   idle      after dispatch.idleExitMinutes with no dispatched worker and nothing it could pick
 *             up, the pool exits and releases pool.pid rather than idling forever. The next
 *             ensure starts a fresh one; a pause outlives it in pool.state.json.
 *
 * `onState(line)` hears one short line per state change (running, paused, resumed, idle,
 * stopped) and nothing per tick; `onTick` still hears every tick (`--json`).
 *
 * A stop sets a flag checked after every tick as well as waking the sleep: a signal that lands
 * mid-tick used to find no sleep to wake and was lost, and with a listener installed the default
 * exit was gone too (TM-175 B5).
 */
export async function runPool({ p = paths(), intervalSeconds = null, registry = null, caps = null, onTick = null, onState = null } = {}) {
  let running = false;
  let paused = false;
  let disabled = false;
  let idleSince = null;
  let stopping = false;
  let wake = null;
  const say = (line) => onState?.(line);
  const stop = () => {
    stopping = true;
    if (wake) wake();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    for (;;) {
      const cfg = config(p);
      if (!poolEnabled(cfg)) {
        disabled = true;
        say("pool: stopped — dispatch.enabled is false");
        break;
      }
      if (!running) {
        const claim = writePoolPid(p);
        if (!claim.ok) {
          const inc = claim.incumbent;
          return { ok: false, reason: `pool already running (pid ${inc?.pid ?? "?"}, started ${inc?.started || "?"})` };
        }
        running = true;
        say(`pool: running (pid ${process.pid})`);
      }
      const tick = await poolTick({ p, registry, caps });
      if (onTick) onTick(tick);
      if (!tick.disabled && Boolean(tick.paused) !== paused) {
        paused = Boolean(tick.paused);
        say(paused ? `pool: paused — ${tick.paused.reason}` : "pool: resumed");
      }
      /**
       * Idle exit: no dispatched worker, and nothing this pool could pick up. A paused pool with
       * no workers is idle too — its queue is unpickable until someone runs `tm pool resume`, and
       * the pause is on disk, so exiting loses nothing and stops burning a process per repo.
       */
      const idleMinutes = Number(cfg.dispatch?.idleExitMinutes ?? 60);
      const idle = idleMinutes > 0 && poolWorkers(p).length === 0 && (paused || poolable(p).length === 0);
      idleSince = idle ? idleSince ?? Date.now() : null;
      if (idleSince && Date.now() - idleSince >= idleMinutes * 60_000) {
        say("pool: idle — exiting");
        break;
      }
      // The lock is never held here: the tick has fully returned before the
      // sleep starts, and withLock scopes itself to single writes regardless.
      const seconds = intervalSeconds ?? Number(cfg.dispatch?.pollSeconds ?? 30);
      if (stopping || !(seconds > 0)) break;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, seconds * 1000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = null;
      if (stopping) break;
    }
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    if (running) releasePoolPid(p); // a refused claimant never held it, and must not delete the holder's
  }
  return { ok: true, stopped: stopping, ...(disabled ? { disabled: true, reason: "dispatch.enabled is false" } : {}) };
}

/** The one line a session starts with: is the pool on, who runs it, how much work, and the switch. */
export function poolLine(p = paths()) {
  if (!poolEnabled(config(p))) return "pool: off (dispatch.enabled false) — tm config dispatch.enabled true";
  const inst = livePool(p);
  const state = inst ? `running (pid ${inst.pid})` : "starting with this session";
  return `pool: on — ${state} · ${poolable(p).length} ready · ${poolWorkers(p).length} working · tm config dispatch.enabled false to stop`;
}
