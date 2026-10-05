/**
 * TM-360: the ONE duplicate-dispatch guard. Does this task already have a worker somebody started?
 *
 * Two dispatchers exist — the pool (`poolTick` → `dispatch()`) and a lead (`ao-topology manage
 * start-worker` → `tm dispatch` → `dispatch()`) — and on 2026-10-05 the pool started a second
 * TM-010 worker the lead knew nothing about. Both reach `dispatch()`, and `dispatch()` asks here,
 * so there is exactly one predicate (verification rule 3: a guard in one caller is worse than none).
 * `tm dispatch-check <id>` exposes the same answer read-only.
 *
 * Two record keepers are consulted:
 *   1. tm's own dispatch record: `task.dispatched` AND a live claim — a worker in flight.
 *   2. agent-orchestration, when installed: `ao-topology manage assignment --task <id>` reports an
 *      unreleased idle-dispatch assignee or a bound, unstopped worker (e.g. one a lead adopted with
 *      `manage bind --pane`, which tm never dispatched and so cannot see).
 *
 * No import crosses into agent-orchestration: it is called through its CLI, and a missing binary,
 * a failed call or unreadable output is skipped — a guard that cannot see must not accuse.
 */
import { spawnSync } from "node:child_process";
import { claimant } from "../claims.mjs";
import { detectHostCaps } from "../hostcaps.mjs";

/** The ao-topology binary, or null. Explicit caps are authoritative (tests pass `{}`). */
function topologyBin(caps) {
  return caps ? caps.backends?.topology?.path ?? null : (detectHostCaps().backends?.topology?.path ?? null);
}

/** ao's view of the task: `{ assigned, worker }` or null when ao is absent or did not answer. */
export function aoAssignment(id, { root, caps = null, spawnImpl = spawnSync, env = process.env } = {}) {
  const bin = topologyBin(caps);
  if (!bin) return null;
  let res;
  try {
    res = spawnImpl(bin, ["manage", "assignment", "--task", id], { cwd: root || undefined, shell: false, encoding: "utf8", env, timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
  if (res?.error || res?.status !== 0) return null;
  try {
    return JSON.parse(res.stdout);
  } catch {
    return null;
  }
}

/**
 * `null` when nobody holds the task, otherwise `{ source, holder, reason }`.
 *   source  "tm-dispatch" | "ao-assignment" | "ao-worker"
 */
export function liveOwner(task, p, { caps = null, spawnImpl = spawnSync, env = process.env } = {}) {
  const id = task.id;
  const claim = claimant(id, p);
  if (task.dispatched && claim) {
    const as = task.dispatched.run ? ` as ${task.dispatched.run}` : "";
    const by = claim.session ?? claim.actor ?? null;
    return {
      source: "tm-dispatch",
      holder: by,
      reason: `${id} is already dispatched to ${task.dispatched.backend}${as}${by ? `, claimed by ${by}` : ""} — confirm the existing worker has ended and collect it first with \`tm collect ${id}\`.`,
    };
  }
  const ao = aoAssignment(id, { root: p?.root, caps, spawnImpl, env });
  if (ao?.assigned && !ao.released_at) {
    return {
      source: "ao-assignment",
      holder: ao.agent_id ?? null,
      reason: `${id} has a live agent-orchestration assignment to ${ao.agent_id ?? "an agent"} — release it first with \`ao-topology manage release --task ${id}\`.`,
    };
  }
  if (ao?.worker) {
    const run = ao.worker.run ? ` (${ao.worker.run})` : "";
    return {
      source: "ao-worker",
      holder: ao.owner ?? null,
      reason: `${id} has a live worker bound by its agent-orchestration lead${run} — stop it first with \`ao-topology manage stop-worker --task ${id}\`.`,
    };
  }
  return null;
}
