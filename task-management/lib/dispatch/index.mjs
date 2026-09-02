/**
 * dispatch: hand a task to a worker, end to end.
 *
 * One verb that composes the seams every surface (CLI `tm dispatch`, MCP
 * `tm_dispatch`, HTTP `POST /api/task/:id/dispatch`) must agree on: claim the
 * task, mark it started, provision its worktree, render the handoff, and launch
 * a backend. Surfaces pick the backend and apply their own gates (gateStart
 * stays with the callers); the mechanics of the hand-off live exactly once, here.
 *
 * Ordering, and why:
 *   1. read      — a done or deleted task is a refusal, not a dispatch.
 *   2. re-dispatch gate — a task with a dispatch record AND a live claim already
 *                  has a worker in flight; re-dispatching would die in git and the
 *                  rollback would release that worker's claim. Refuse first
 *                  (skipped by --steal, which claims deliberately).
 *   3. claim     — before anything exists on disk, so a refused dispatch leaves
 *                  nothing behind. The refusal propagates claimTask's holder-named
 *                  reason verbatim: "who has it" is the answer the caller needs.
 *   4. status    — in_progress via update(), the same write `tm start` performs, so
 *                  the board reads the same however the task was started.
 *   5. provision — claim first, then checkout (provision claims again with the
 *                  worktree and branch; same session, so it re-stamps, not steals).
 *   6. spawn     — the backend launches the worker.
 *
 * On ANY failure after a claim this call created, that claim is released and the
 * status put back — a dispatch that did not start a worker must leave the task
 * exactly as open as it found it, or the board shows in-progress work nobody is
 * doing. A claim that PREDATES this call is never released here.
 */
import { claimTask, claimant, heartbeatClaim, releaseClaim } from "../claims.mjs";
import { listAgents, registerAgent } from "../agents.mjs";
import { provision } from "../worktree.mjs";
import { handoff } from "../render.mjs";
import { RESOLVED, config, logEvent, mutate, now, read, update } from "../store.mjs";
import { paths } from "../paths.mjs";
import { resolveBackend } from "./backend.mjs";

/**
 * One heartbeat, driven from outside — the pool loop and other supervisors call
 * this rather than running their own interval per task. Returns the refreshed
 * claim, or null when there is nothing left to keep alive (claim gone, or held
 * by somebody else now). Never throws: a heartbeat must not fail its supervisor.
 */
export function heartbeatOnce(id, session, p = paths()) {
  try {
    return heartbeatClaim(id, { session, p });
  } catch {
    return null;
  }
}

/**
 * Keep a dispatched claim alive while the worker is.
 *
 * Without this, a long-running worker holds its claim only until claimTtlMinutes
 * runs out — the wall clock, not liveness, decides. The loop re-stamps the
 * claim's `ts` every `dispatch.heartbeatSeconds` (default 60; 0 disables) and
 * stops itself the moment there is nothing to keep alive: the claim is gone
 * (finished, released, stolen) or the registry says the worker is dead. It is
 * unref'd so a heartbeat can never hold a process open, and failure-tolerant
 * like every registry interaction here.
 */
function startHeartbeat(id, session, agentName, p) {
  const seconds = Number(config(p).dispatch?.heartbeatSeconds ?? 60);
  if (!(seconds > 0)) return null;
  const timer = setInterval(() => {
    try {
      const worker = listAgents(p).find((a) => a.name === agentName);
      if (!worker?.alive || !heartbeatClaim(id, { session, p })) clearInterval(timer);
    } catch {
      /* a missed beat is retried next tick; it must never crash the dispatcher */
    }
  }, seconds * 1000);
  timer.unref();
  return timer;
}

/**
 * Dispatch one task.
 *
 *   id        the task
 *   backend   a backend NAME ("tmux"), a backend OBJECT (tests, ad-hoc launchers),
 *             or null to walk the configured fallback order
 *   session   the dispatching session id; stamped on the claim and the worker's env
 *   actor     who is dispatching; same
 *   steal     pass through to claimTask — take a live claim deliberately
 *   p         store paths
 *   caps/registry   injectable host capabilities / module registry (tests)
 *
 * Returns { ok, backend?, run?, worktree?, branch?, detail?, reason?, holder?, tried? }.
 */
export async function dispatch(id, { backend = null, session = null, actor = null, steal = false, p = paths(), caps = null, registry = null } = {}) {
  const task = read(id, p);
  if (!task) return { ok: false, reason: `not found: ${id}` };
  if (RESOLVED.has(task.status)) {
    return { ok: false, reason: `${id} is ${task.status} — dispatch is for open work. Reopen it first if it genuinely needs doing.` };
  }

  const picked =
    backend && typeof backend === "object"
      ? { name: backend.name || "custom", backend, tried: [] }
      : await resolveBackend({ requested: backend, caps, registry, p });
  if (!picked.backend) {
    const why = picked.tried.map((t) => `${t.name}: ${t.reason}`).join("; ");
    return { ok: false, reason: `no dispatch backend available (${why})`, tried: picked.tried };
  }

  /**
   * A dispatch always carries a real session id. A null session makes an UNOWNED
   * claim (claims.mjs treats it as interlock-free legacy state) and injects an
   * empty TM_SESSION_ID into the worker — so a harness-less caller (a plain shell,
   * a cron) gets a synthetic one that interlocks and attributes properly.
   */
  if (!session) session = `dispatch-${id.toLowerCase()}`;

  /**
   * A task already carrying a dispatch record AND a live claim is a worker in
   * flight, not a dispatch candidate. Without this gate, a same-session
   * re-dispatch re-claims idempotently and then dies inside provision() ("worktree
   * already exists") — and the rollback would release the LIVE worker's claim.
   * Refuse early with the way forward instead. `--steal` skips this gate: stealing
   * a live claim is exactly what claimTask's steal path is for.
   */
  const priorClaim = claimant(id, p);
  if (!steal && task.dispatched && priorClaim) {
    const as = task.dispatched.run ? ` as ${task.dispatched.run}` : "";
    const by = priorClaim.session ?? priorClaim.actor;
    const holder = by ? `, claimed by ${by}` : "";
    return {
      ok: false,
      reason: `${id} is already dispatched to ${task.dispatched.backend}${as}${holder} — collect it first with \`tm collect ${id}\`, or steal it deliberately with --steal.`,
      holder: by ?? null,
    };
  }

  const claim = claimTask(id, { session, actor, steal, p });
  if (!claim.ok) return { ok: false, reason: claim.reason, holder: claim.holder };

  const priorStatus = task.status;
  const fail = (reason, extra = {}) => {
    /**
     * Roll back only what THIS call created. If a claim predates this dispatch
     * (reachable via --steal past a stale dispatched record), releasing it would
     * yank the rug from a live worker over a failure it had no part in.
     */
    if (!priorClaim) releaseClaim(id, p);
    if (read(id, p)?.status !== priorStatus) update(id, { status: priorStatus }, p);
    return { ok: false, reason, backend: picked.name, ...extra };
  };

  update(id, { status: "in_progress", ...(session ? { session } : {}), ...(actor ? { actor } : {}) }, p);

  let prov;
  try {
    prov = provision(task, { session, actor, steal, p });
  } catch (err) {
    return fail(`worktree provisioning failed: ${err.message}`);
  }
  if (!prov.ok) return fail(prov.reason, { holder: prov.holder });

  const prompt = handoff(id, p);
  const res = await picked.backend.spawn({ task: read(id, p), worktree: prov.path, prompt, session, actor, p });
  if (!res?.ok) return fail(res?.reason || `${picked.name} did not start a worker`, { detail: res?.detail });

  const dispatched = { backend: picked.name, run: res.run ?? null, session, at: now() };
  mutate(id, () => ({ dispatched }), p);
  logEvent("dispatched", { id, backend: picked.name, run: res.run ?? null, session }, p);
  /**
   * Register the worker the spawn just started. Additive and failure-tolerant by
   * contract: the registry observes the dispatch, it must never be able to fail
   * one — a broken agents.json is a missing panel, not a lost hand-off.
   */
  const agentName = `agent:${id}-${String(session || "shell").slice(0, 8)}`;
  try {
    registerAgent(
      {
        name: agentName,
        backend: picked.name,
        runId: res.run ?? null,
        pid: typeof res.pid === "number" ? res.pid : null,
        session,
      },
      p,
    );
  } catch {
    /* registry errors must never fail a dispatch */
  }
  /**
   * Hold the claim by liveness from here on: the loop re-stamps it until the
   * claim is gone or the registry calls the worker dead. Same failure contract
   * as registration — a broken heartbeat is a stale claim, not a failed dispatch.
   */
  try {
    startHeartbeat(id, session, agentName, p);
  } catch {
    /* ignore */
  }
  return {
    ok: true,
    id,
    backend: picked.name,
    run: res.run ?? null,
    worktree: prov.path,
    branch: prov.branch,
    detail: res.detail,
  };
}
