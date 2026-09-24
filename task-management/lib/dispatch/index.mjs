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
 *   1b. duplicate gate — work that already landed outside the dispatch system is
 *                  invisible to claims, touches and readiness, because none of
 *                  them read the repository. Refuse before anything is claimed
 *                  (skipped by --steal). See duplicate.mjs.
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
import { join } from "node:path";
import { listAgents, registerAgent } from "../agents.mjs";
import { provision, resolveIntegrationBranch } from "../worktree.mjs";
import { handoff } from "../render.mjs";
import { RESOLVED, config, logEvent, mutate, now, read, update } from "../store.mjs";
import { paths } from "../paths.mjs";
import { resolveBackend } from "./backend.mjs";
import { describeDuplicates, duplicateCommits, duplicateGuardEnabled } from "./duplicate.mjs";
import { failureScope } from "./failure.mjs";
import { governedAdmission } from "../governance-check.mjs";

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
  /**
   * A dispatched worker's PR base comes from this value, stated literally (render.mjs, the
   * worker guard). Unconfigured resolves to the main checkout's actual branch name, so `gh pr
   * create` is always given a concrete `--base` rather than falling back to the repository
   * default silently (TM-235) — refusing only when there is truly nothing to resolve to, e.g. a
   * detached HEAD.
   */
  const integration = resolveIntegrationBranch(p, config(p));
  if (!integration) {
    return {
      ok: false,
      reason: `no integration branch could be resolved — dispatch.integrationBranch is unset and the main checkout's HEAD is not on a branch (detached?). Set it: \`tm config dispatch.integrationBranch <branch>\`.`,
      failureScope: "config",
    };
  }
  if (config(p).dispatch?.governed === true || task.governance) {
    const gate = governedAdmission(task, p);
    if (!gate.allow) return { ok: false, ...gate, failureScope: "task" };
    session ||= gate.owner;
  }

  /**
   * Somebody may have already done this. The store tracks claims, not commits, so
   * work that landed outside the dispatch system is invisible to every other gate
   * here. Refuse before the claim, so a duplicate dispatch leaves nothing behind.
   *
   * `--steal` skips it for the same reason it skips the re-dispatch gate: an
   * operator overriding on purpose has seen the commits the refusal named.
   */
  if (!steal && duplicateGuardEnabled(config(p))) {
    const dupes = duplicateCommits(task, p);
    if (dupes.length) {
      return {
        ok: false,
        reason: `${id} looks already done: ${describeDuplicates(dupes)} — check whether this work landed outside the dispatch system before spending a worker on it. Dispatch anyway with --steal, or turn this off with \`tm config dispatch.duplicateGuard false\`.`,
        duplicates: dupes,
      };
    }
  }

  const picked =
    backend && typeof backend === "object"
      ? { name: backend.name || "custom", backend, tried: [] }
      : await resolveBackend({ requested: backend, caps, registry, p });
  if (!picked.backend) {
    const why = picked.tried.map((t) => `${t.name}: ${t.reason}`).join("; ");
    return { ok: false, reason: `no dispatch backend available (${why})`, tried: picked.tried, failureScope: "backend" };
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
  if (task.dispatched && priorClaim) {
    const as = task.dispatched.run ? ` as ${task.dispatched.run}` : "";
    const by = priorClaim.session ?? priorClaim.actor;
    const holder = by ? `, claimed by ${by}` : "";
    return {
      ok: false,
      reason: `${id} is already dispatched to ${task.dispatched.backend}${as}${holder} — confirm the existing worker has ended and collect it first with \`tm collect ${id}\`.`,
      holder: by ?? null,
    };
  }

  const claim = claimTask(id, { session, actor, steal, p });
  if (!claim.ok) return { ok: false, reason: claim.reason, holder: claim.holder };

  const priorStatus = task.status;
  let prov;
  const fail = (reason, extra = {}) => {
    // A failed launch can already have written work or runtime evidence. Preserve its
    // checkout and recorded placement; the next dispatch validates and reuses it.
    if (prov?.ok) {
      logEvent("dispatch_retained", { id, worktree: prov.path, reason }, p);
      update(id, { dispatchFailure: { backend: picked.name, reason, at: now(), worktree: prov.path, ...(extra.detail || {}) } }, p);
    }
    if (!priorClaim) releaseClaim(id, p);
    if (read(id, p)?.status !== priorStatus) update(id, { status: priorStatus }, p);
    return { ok: false, reason, backend: picked.name, failureScope: "task", ...extra };
  };

  update(id, { status: "in_progress", ...(session ? { session } : {}), ...(actor ? { actor } : {}) }, p);

  try {
    prov = provision(task, { base: integration, session, actor, steal, p });
  } catch (err) {
    return fail(`worktree provisioning failed: ${err.message}`);
  }
  if (!prov.ok) return fail(prov.reason, { holder: prov.holder });
  // Recorded on the task, not just pinned into the worker's env, so `tm show` and a later
  // `handoff()` call (dashboard, `tm handoff`) state the same PR base this dispatch resolved.
  update(id, { integrationBranch: integration }, p);

  const prompt = handoff(id, p);
  let res;
  try {
    res = await picked.backend.spawn({ task: read(id, p), worktree: prov.path, branch: prov.branch, integrationBranch: integration, prompt, session, actor, p });
  } catch (err) {
    return fail(`worker launch failed: ${err.message}`, { failureScope: failureScope({ reason: err.message }, "backend") });
  }
  if (!res?.ok) return fail(res?.reason || `${picked.name} did not start a worker`, { detail: res?.detail, failureScope: failureScope(res || {}, "backend") });

  const dispatched = { backend: picked.name, run: res.run ?? null, session, at: now(), ...(res.nativeRunId ? { nativeRunId: res.nativeRunId } : {}), ...(res.workflowRunId ? { workflowRunId: res.workflowRunId } : {}), ...(res.detail?.runDir ? { recordPath: join(res.detail.runDir, "run.json") } : {}) };
  mutate(id, () => ({ dispatched, dispatchFailure: undefined }), p);
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
