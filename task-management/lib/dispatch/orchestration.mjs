/**
 * The orchestration backend: hand the task to the sibling agent-orchestration
 * plugin, speaking MCP as a stdio CLIENT.
 *
 * Why a client and not a shell-out: agent-orchestration's public contract IS its
 * MCP server (`orchestration_spawn` et al.). There is no CLI verb for "start a
 * run", so dispatch spawns the server (`node bin/agent-orchestration-mcp`),
 * performs one initialize → tools/call handshake, takes the run id, and lets the
 * server go — the RUN continues server-side (durable, supervised), only the
 * launch channel closes. The 120s default timeout bounds the HANDSHAKE, never
 * the run.
 *
 * Rules this module never breaks:
 *   1. argv-only, `shell: false`. The prompt is a task's handoff — arbitrary
 *      markdown — and it travels exactly one way: as a string inside the JSON
 *      `task` field written to the child's stdin. It is never an argv element,
 *      never shell source, never a file the server is pointed at.
 *   2. `consumerCwd` is req.worktree — the tm-provisioned checkout of this repo.
 *      Orchestration rejects relative or non-repo cwd by contract, and derives
 *      its OWN detached worktree underneath (its invariant 9), so the tm
 *      worktree is the consumer root, not the scratch the worker edits.
 *   3. `permissionProfile: "write"`. The tool default is read; a dispatch that
 *      cannot write is a worker that cannot do the task.
 *   4. `idempotencyKey` is `<task.id>-<session>`, so a retried dispatch (flaky
 *      network, a re-run verb) collapses onto the same run instead of
 *      double-spawning a worker for a task that already has one.
 *   5. Bounded, always: stdout is capped (a runaway server must not grow our
 *      heap), the handshake is timed, the child is killed on timeout/error,
 *      stdin is never written after it closes, and stderr is tolerated as free
 *      text — orchestration's invariant 5 reserves stdout for JSON-RPC only, so
 *      a non-JSON stdout line is a protocol violation, while stderr noise is not.
 *
 * The channel itself — child lifecycle, framing, caps, the kill-on-settle rules —
 * lives in ./mcp-client.mjs, shared with the collector (./collect.mjs). This
 * module owns what a dispatch asks for and how the answer maps to a run.
 */
import { isAbsolute } from "node:path";
import { detectHostCaps } from "../hostcaps.mjs";
import { MAX_BUFFER_BYTES, rpcSession } from "./mcp-client.mjs";

export const name = "orchestration";

/** The launch handshake's budget. The run itself is supervised server-side. */
export const SPAWN_TIMEOUT_MS = 120_000;
/** stdout is JSON-RPC frames; the cap itself lives with the shared client. */
export { MAX_BUFFER_BYTES };

/** Available exactly when hostcaps found the agent-orchestration MCP binary. */
export function available(caps = null) {
  const report = caps ?? detectHostCaps();
  return Boolean(report?.backends?.orchestration?.available);
}

/**
 * Task → orchestration intent. Research-labelled decision work researches, bugs
 * are operations, everything else is implementation — the intent steers routing,
 * and "write code for the task" is the sane default for a dispatch.
 */
export function intentFor(task) {
  const labels = Array.isArray(task?.labels) ? task.labels : [];
  if (labels.some((l) => String(l).includes("decision:research"))) return "research";
  if (task?.type === "bug") return "operations";
  return "implementation";
}

/**
 * The orchestration_spawn arguments, as a pure value. Keeping this side-effect-free
 * is what lets a test prove the request shape — absolute consumerCwd, write
 * profile, idempotency key, prompt as DATA — without a server.
 */
export function toolArguments(req) {
  return {
    consumerCwd: req.worktree,
    intent: intentFor(req.task),
    task: req.prompt,
    permissionProfile: "write",
    expectedOutput: "The task's acceptance criteria met, with proof, in the run's detached worktree.",
    idempotencyKey: `${req.task.id}-${req.session ?? "no-session"}`,
  };
}

/** One JSON-RPC response → a dispatch result. */
function mapToolResult(msg) {
  if (msg.error) {
    return { ok: false, reason: `orchestration_spawn RPC error ${msg.error.code}: ${msg.error.message}` };
  }
  const result = msg.result ?? {};
  // The server answers in both channels: structuredContent for typed clients,
  // the same JSON as text content for the rest. Prefer the typed one.
  let envelope = result.structuredContent;
  if (!envelope && Array.isArray(result.content)) {
    const text = result.content.find((c) => c?.type === "text")?.text;
    if (text) {
      try {
        envelope = JSON.parse(text);
      } catch {
        /* fall through to the refusal below */
      }
    }
  }
  const data = envelope?.data;
  const runId = data?.run?.runId;
  if (!result.isError && typeof runId === "string" && runId) {
    return { ok: true, run: `orchestration:${runId}`, detail: { runId, state: data.run.state ?? null } };
  }
  // Error envelopes carry {code, message} in the same `data` slot.
  return {
    ok: false,
    reason: data?.message
      ? `orchestration_spawn refused: ${data.code ? `${data.code}: ` : ""}${data.message}`
      : "orchestration_spawn returned no run id",
  };
}

/**
 * Launch the run. req = { task, worktree, prompt, session, actor, p }.
 * Injectables (caps/spawnImpl/timeoutMs/maxBuffer/env) exist for tests; production
 * takes the probed hostcaps and the real child_process.spawn (the client's default).
 */
export async function spawn(req, { caps = null, spawnImpl, timeoutMs = SPAWN_TIMEOUT_MS, maxBuffer = MAX_BUFFER_BYTES, env = process.env } = {}) {
  const report = caps ?? detectHostCaps();
  const entry = report?.backends?.orchestration;
  if (!entry?.available || !entry.path) {
    return { ok: false, reason: entry?.reason ?? "orchestration backend is not available on this host" };
  }
  if (!isAbsolute(String(req.worktree ?? ""))) {
    return { ok: false, reason: `consumerCwd must be an absolute path; got worktree: ${req.worktree}` };
  }
  const res = await rpcSession({
    bin: process.execPath,
    argv: [entry.path],
    env,
    timeoutMs,
    maxBuffer,
    spawnImpl,
    label: "orchestration MCP",
    timeoutNote: "whether a run started is unknowable from here",
    calls: [{ name: "orchestration_spawn", arguments: toolArguments(req) }],
  });
  if (!res.ok) return res;
  return mapToolResult(res.results[0]);
}
