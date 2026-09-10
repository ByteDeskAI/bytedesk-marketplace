/**
 * The idle backend: hand this task to an agent that is ALREADY RUNNING.
 *
 * Every other backend answers "how do I start a worker". This one answers "who is free", and the
 * difference is the whole design: a standing agent has a warm provider, a loaded identity, a
 * memory, and a startup cost that has already been paid. Dispatching into one costs a file write.
 *
 * It is a BACKEND, not a second scheduler. dispatch/index.mjs calls a backend at step 6 — after the
 * claim at step 3 and the worktree at step 5 — so every ordering invariant this module could
 * possibly get wrong is already held for free, and a refusal rolls back through the existing
 * `fail()` path that never releases a claim it did not create. There are ZERO edits to index.mjs,
 * and that is the point rather than an accident.
 *
 * Rules, all borrowed rather than invented:
 *
 *   1. **tm still owns the checkout.** The task worktree is provisioned before spawn() is called,
 *      and the topology layer's `ownedTask` refuses an assignment without one. A standing agent's
 *      cwd is its own agent directory by design — that is what gives it its own memory — so the
 *      worktree travels to it as an absolute path, and one task still means exactly one checkout.
 *   2. **argv-only, `shell: false`.** The handoff is arbitrary markdown; it travels to the agent as
 *      a FILE PATH and never as an argv element, a shell word, or a message body.
 *   3. **Arbitration is not here.** This module names a candidate at most; `ao-topology manage
 *      assign` reads liveness and writes the binding inside one critical section. Deciding "that
 *      agent looks idle" here and writing the binding there is precisely how two ticks hand one
 *      pane two tasks.
 *   4. **A dispatch always carries a real session id (CAP-0002).** spawn() refuses without one, so
 *      this path can only ever produce an OWNED claim.
 *
 * The run handle is `idle:<agentId>` — ./collect.mjs reads the completion from the agent's standing
 * mailbox reply, NOT from session death: the session outlives the task, which is the entire point.
 */
import { spawnSync } from "node:child_process";
import { toolFailureReason } from "./backend.mjs";
import { writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { detectHostCaps } from "../hostcaps.mjs";
import { PROMPT_FILE, envFor } from "./topology.mjs";

export const name = "idle";

/** Assignment is a file write behind a lock, not a provider launch. It does not need 180 seconds. */
export const ASSIGN_TIMEOUT_MS = 30_000;
export const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

export { PROMPT_FILE };

/** Available exactly when the topology CLI is: `manage assign` is one of its verbs. */
export function available(caps = null) {
  const report = caps ?? detectHostCaps();
  return Boolean(report?.backends?.topology?.available);
}

/** The exact ao-topology argv. `--agent` is a PIN, omitted so arbitration picks. */
export function argvFor(req, promptFile, agent = null) {
  return ["manage", "assign", "--task", String(req.task.id), "--consumer", req.worktree, "--prompt-file", promptFile, ...(agent ? ["--agent", agent] : [])];
}

/** `ao-topology --json`-ish stdout → the assignment. Anything unparseable is a refusal that quotes it. */
export function parseAssign(stdout) {
  try {
    const record = JSON.parse(String(stdout || ""));
    if (record?.assigned === true && typeof record.agent_id === "string" && record.agent_id) return { record };
  } catch {
    /* fall through */
  }
  const tail = String(stdout || "").trim().slice(-300);
  return { reason: `ao-topology manage assign printed no assignment JSON${tail ? `: ${tail}` : ""}` };
}

/**
 * Assign the worker. req = { task, worktree, prompt, session, actor, p }.
 * Injectables exist for tests; production takes the probed hostcaps and real spawnSync.
 */
export function spawn(
  req,
  { caps = null, spawnImpl = spawnSync, writeImpl = writeFileSync, env = process.env, agent = null, timeoutMs = ASSIGN_TIMEOUT_MS, maxBuffer = MAX_BUFFER_BYTES } = {},
) {
  /**
   * CAP-0002, one deliberate line. A null session writes an UNOWNED claim: the stop gate cannot
   * attribute it, and every session's Stop hook then nags about a task it does not hold. dispatch()
   * already synthesises one, so this is unreachable from the normal path — which is exactly why it
   * is cheap to assert and worth asserting, because a backend called directly is the path that
   * would reintroduce the shape.
   */
  if (!req?.session) {
    return { ok: false, reason: "idle dispatch requires a session id; a null-session claim cannot be attributed to the agent that holds it (CAP-0002)" };
  }
  const report = caps ?? detectHostCaps();
  const entry = report?.backends?.topology;
  if (!entry?.available || !entry.path) {
    return { ok: false, reason: entry?.reason ?? "topology backend is not available on this host, so there is nothing to assign through" };
  }
  // The consumer is the contract with the topology layer; a relative path would resolve the
  // assignment against the wrong checkout. Same rule as the topology backend.
  if (!isAbsolute(String(req.worktree ?? ""))) {
    return { ok: false, reason: `--consumer must be an absolute path; got worktree: ${req.worktree}` };
  }

  // The durable copy of the handoff, at the SAME filename every other backend uses: the assigned
  // agent is told to read this path, and a human resuming the task reads exactly what it was told.
  const promptFile = join(req.worktree, PROMPT_FILE);
  writeImpl(promptFile, req.prompt);

  const args = argvFor(req, promptFile, agent);
  const res = spawnImpl(entry.path, args, {
    shell: false,
    env: envFor(req, env),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer,
  });
  if (res?.error) return { ok: false, reason: `ao-topology failed to start: ${res.error.message}`, detail: { args } };
  if (res?.status !== 0) {
    return { ok: false, reason: toolFailureReason("ao-topology manage assign", res), detail: { args } };
  }

  const parsed = parseAssign(res.stdout);
  if (!parsed.record) return { ok: false, reason: parsed.reason, detail: { args } };
  return {
    ok: true,
    // No pid and no session: nothing was started. The handle names WHO, and collect.mjs asks the
    // topology layer for that agent's reply.
    run: `idle:${parsed.record.agent_id}`,
    detail: { args, promptFile, agent: parsed.record.agent_id, messageId: parsed.record.message_id ?? null },
  };
}
