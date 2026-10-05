/**
 * Claims — the interlock for parallel work.
 *
 * One store is shared by every worktree of a project, so two sessions can reach for
 * the same task at the same moment. A claim records who holds it and where. It has
 * to expire, though: a session that crashes or a worktree that gets deleted must not
 * lock a task out of the board forever. Taking a live claim is allowed but never
 * silent — you steal explicitly, and it lands in the event log.
 */
import { captureGatewayBinding } from "./gateway-binding.mjs";
import { existsSync } from "node:fs";
import { config, logEvent, now, state, withLock, writeState } from "./store.mjs";
import { paths } from "./paths.mjs";

/** A claim is dead if it aged out, lost its worktree, or never carried a timestamp. */
export function expired(claim, p = paths()) {
  if (!claim || !claim.ts) return true;
  if (claim.worktree && !existsSync(claim.worktree)) return true;
  const ttl = (config(p).claimTtlMinutes ?? 240) * 60_000;
  if (!ttl) return false;
  return Date.now() - Date.parse(claim.ts) > ttl;
}

/** The live holder of a task, or null. */
export function claimant(id, p = paths()) {
  const claim = state(p).claims?.[id];
  return claim && !expired(claim, p) ? claim : null;
}

/**
 * Claim a task for a session. Refuses when someone else holds it and is still alive,
 * unless `steal` is set. The refusal names the holder and their worktree — "someone
 * else has it" is useless when you're deciding whether to interrupt a teammate.
 */
export function claimTask(id, { session = null, actor = null, worktree, branch, steal = false, p = paths() } = {}) {
  const gateway = captureGatewayBinding(session);
  return withLock(p, () => {
    const claims = { ...state(p).claims };
    const held = claims[id];
    const live = held && !expired(held, p);

    /**
     * A claim with no session is unowned, not foreign.
     *
     * Until sessions actually resolved, every claim ever written carried `session: null` — the
     * plugin read an environment variable Claude Code does not set. Two nulls compared equal, so
     * the interlock quietly never fired. The moment a real id starts flowing, `null !== "abc123"`
     * becomes true and the holder of *your own* in-progress task is a stranger: `tm start` refuses
     * work you have been resuming freely, and `--steal` would log you stealing from yourself.
     *
     * Treating a null-session claim as unowned keeps exactly the behaviour those claims already
     * had — no interlock, no refusal — while letting a real id interlock properly. That also
     * covers `tm` driven from a plain shell, where there is no session to record and never was.
     */
    const owned = live && held.session != null;

    if (owned && held.session !== session && !steal) {
      return {
        ok: false,
        holder: held,
        reason:
          `${id} is claimed by ${held.actor || `session ${held.session || "unknown"}`}` +
          (held.worktree ? ` in ${held.worktree}` : "") +
          (held.branch ? ` on ${held.branch}` : "") +
          `\nTake it anyway with --steal, or pick something else with \`.bytedesk/task-management/bin/tm next\`.`,
      };
    }

    const stolenFrom = owned && held.session !== session ? held.session : null;
    // `ts` moves with every heartbeat; `since` is when this claim was TAKEN, which is what
    // collect asks when it decides whether a lead re-claimed after a dispatch (TM-460).
    // A dispatched worker carries its lead's TM_SESSION_ID, so its own `tm start`/`tm claim` would
    // otherwise look like the lead re-claiming: it is marked `worker` and keeps the earlier `since`.
    const at = now();
    const worker = Boolean(process.env.TM_DISPATCH_WORKER);
    const since = worker && live && held.session === session && held.since ? held.since : at;
    claims[id] = { session, actor, worktree, branch, pid: process.pid, ts: at, since, ...(worker ? { worker: true } : {}), ...(gateway ? { gateway } : {}) };
    writeState({ claims }, p);
    if (stolenFrom) logEvent("claim_stolen", { id, from: stolenFrom, to: session }, p);
    else logEvent("claim", { id, session }, p);
    return { ok: true, stolenFrom };
  });
}

/**
 * Refresh a claim's timestamp — renewal works by moving `ts`, so `expired()`
 * stays exactly as it is and a live worker simply never ages out.
 *
 * Only the current holder can keep a claim alive: a stranger's heartbeat returns
 * null and changes nothing, or a dead worker's supervisor could pin somebody
 * else's task forever. The null-session rule from claimTask holds here too — an
 * unowned claim can be refreshed by anyone, and refreshing it does NOT adopt it
 * (the record keeps `session: null`). Same-session refreshes are idempotent.
 *
 * Logs NOTHING. A heartbeat is a pulse; an event per pulse is the write stream
 * that makes people switch the log off.
 */
export function heartbeatClaim(id, { session = null, p = paths() } = {}) {
  const gateway = captureGatewayBinding(session);
  return withLock(p, () => {
    const claims = { ...state(p).claims };
    const held = claims[id];
    if (!held) return null;
    if (held.session != null && held.session !== session) return null;
    claims[id] = { ...held, ts: now(), ...(held.session === session && gateway ? { gateway } : {}) };
    writeState({ claims }, p);
    return claims[id];
  });
}

/**
 * TM-397: "a live worker of this session is doing this task" — the marker the Stop gate honours.
 *
 * A lead that hands claimed tasks to worker subagents was told at every stop to done/block/park
 * them, and parking releases the claim mid-work so the pool re-dispatches it. The lead (or the
 * worker) records `{ worker, until }` on the claim instead; it also re-stamps the claim, so it doubles
 * as a heartbeat. Only the claim's own session may write it. Returns the claim, or null when the
 * task is not claimed by this session.
 */
export function noteClaimWorker(id, { session = null, worker, ttlMs = 60 * 60_000, p = paths() } = {}) {
  return withLock(p, () => {
    const claims = { ...state(p).claims };
    const held = claims[id];
    if (!held || expired(held, p) || held.session !== session) return null;
    claims[id] = { ...held, ts: now(), worker: { name: String(worker), until: new Date(Date.now() + ttlMs).toISOString() } };
    writeState({ claims }, p);
    logEvent("claim_worker_noted", { id, worker: String(worker), until: claims[id].worker.until }, p);
    return claims[id];
  });
}

/** The claim's worker marker while it is fresh, else null. */
export function liveWorkerNote(claim, nowMs = Date.now()) {
  const until = claim?.worker?.until ? new Date(claim.worker.until).getTime() : NaN;
  return until > nowMs ? claim.worker : null;
}

export function releaseClaim(id, p = paths()) {
  return withLock(p, () => {
    const claims = { ...state(p).claims };
    if (!(id in claims)) return false;
    delete claims[id];
    writeState({ claims }, p);
    logEvent("release", { id }, p);
    return true;
  });
}

/** Claims whose sessions are gone — surfaced at SessionStart so the board self-heals. */
export function staleClaims(p = paths()) {
  return Object.entries(state(p).claims || {})
    .filter(([, claim]) => expired(claim, p))
    .map(([id, claim]) => ({ id, ...claim }));
}

/** Drop every dead claim. Returns the ids it freed. */
export function sweepClaims(p = paths()) {
  const dead = staleClaims(p);
  if (!dead.length) return [];
  withLock(p, () => {
    const claims = { ...state(p).claims };
    for (const { id } of dead) delete claims[id];
    writeState({ claims }, p);
  });
  logEvent("claims_swept", { ids: dead.map((c) => c.id) }, p);
  return dead.map((c) => c.id);
}
