/**
 * collect: turn a dispatched worker's completion into store truth.
 *
 * dispatch (./index.mjs) starts the worker and records `dispatched:{backend,run,...}`
 * on the task. What it cannot do is know how that worker ENDED — each backend has a
 * different completion signal: an orchestration run reaches a terminal state, a tmux
 * session disappears, a fleet ticket emits a terminal event. The collectors here
 * normalize each of those into one call to `recordResult`, which is the protocol's
 * single write path.
 *
 * The protocol's invariants, all enforced in recordResult rather than in the
 * collectors:
 *
 *   1. The AC gate stays the real gate. A collector never closes a task — the worker
 *      closes it through `tm done` (the handoff's "When you finish" contract). A
 *      worker that REPORTS done for a task that is not done is a failure, not a
 *      close: the outcome downgrades to failed with the status named.
 *   2. Failure parks, never strands. A blocked/failed outcome on a task that is still
 *      in_progress parks it with the summary as the reason and releases the claim —
 *      an exited worker must never leave the board showing in-progress work nobody
 *      is doing.
 *   3. Everything is recorded: the summary lands as a comment and one `task_result`
 *      event ({ id, run, outcome }) lands in the log, so `tm log` tells the story.
 *   4. Fire-and-forget safe. Every function here is bounded and never throws — a
 *      collector that throws takes down whatever hook or sweep called it, so
 *      failures come back as `{ ok: false, reason }`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { releaseClaim } from "../claims.mjs";
import { addComment } from "../issue.mjs";
import { detectHostCaps } from "../hostcaps.mjs";
import { logEvent, read, update } from "../store.mjs";
import { paths } from "../paths.mjs";
import { rpcSession } from "./mcp-client.mjs";

/** A collection is a quick query, not the 120s launch handshake. */
export const COLLECT_TIMEOUT_MS = 30_000;

const OUTCOMES = new Set(["done", "blocked", "failed"]);

/** Orchestration's TERMINAL_STATES (agent-orchestration/src/state/store.mjs). */
const ORCH_TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out", "rejected", "recovery_required"]);

/**
 * Fleet's event stream (claude-sessions events <ticket> --json: one
 * {ts, ticket, depth, kind, detail} per line) is tool-level observability, so it
 * has no "closed" kind. The terminal signals it DOES carry: a merge means the
 * work landed and the worker's job is over; an error event means it is not
 * coming back. Anything else is progress, not an ending.
 */
const FLEET_TERMINAL = { merge: "done", error: "failed" };

/**
 * Record one worker's result against the store. This is the only write path the
 * protocol has; collectors only normalize signals into it.
 *
 *   id        the task
 *   run       the backend run handle (defaults to task.dispatched.run)
 *   outcome   "done" | "blocked" | "failed" — what the worker's signal claims
 *   summary   what happened, in the worker's words; parked as the reason, stored
 *             as a comment
 *
 * Returns { ok, id?, outcome?, downgraded?, parked?, reason? }. Never throws.
 */
export function recordResult(id, result = {}, p = paths()) {
  try {
    const { run = null, outcome, summary = "" } = result ?? {};
    const task = read(id, p);
    if (!task) return { ok: false, reason: `not found: ${id}` };
    if (!task.dispatched?.run) {
      return { ok: false, reason: `${id} was never dispatched — there is no worker result to record` };
    }
    if (!OUTCOMES.has(outcome)) return { ok: false, reason: `unknown outcome: ${outcome}` };

    let final = outcome;
    let note = String(summary || "").trim();

    /**
     * "done" is a claim about the store, and the store gets the last word. The
     * worker closes through the gates itself; if it reported done without doing
     * that, the report is wrong and the honest recording is a failure that says so.
     */
    if (final === "done" && task.status !== "done") {
      final = "failed";
      const why = `worker reported done but task is ${task.status}`;
      note = note ? `${note}\n\n${why}` : why;
    }

    let parked = false;
    if ((final === "blocked" || final === "failed") && task.status === "in_progress") {
      update(id, { status: "parked", parkedReason: note || `worker ${final}` }, p);
      releaseClaim(id, p);
      parked = true;
    }

    if (note) addComment(id, note, { author: `worker:${task.dispatched.backend}`, p });
    logEvent("task_result", { id, run: run ?? task.dispatched.run, outcome: final }, p);
    return { ok: true, id, outcome: final, downgraded: final !== outcome, parked };
  } catch (err) {
    return { ok: false, reason: `recordResult failed for ${id}: ${err.message}` };
  }
}

/** A tools/call response → its envelope `data`, through either channel the server answers on. */
function envelopeData(msg) {
  if (!msg || msg.error) return null;
  const result = msg.result ?? {};
  if (result.isError) return null;
  if (result.structuredContent) return result.structuredContent.data ?? null;
  const text = Array.isArray(result.content) ? result.content.find((c) => c?.type === "text")?.text : null;
  if (!text) return null;
  try {
    return JSON.parse(text)?.data ?? null;
  } catch {
    return null;
  }
}

/** One line of a run's outputs, bounded — a worker's whole report is not a comment. */
function summarizeRun(run) {
  const text = (run?.outputs || []).map((o) => o?.text).find((t) => typeof t === "string" && t.trim());
  if (!text) return `orchestration run ${run?.runId ?? "?"} ended ${run?.state ?? "unknown"}`;
  const oneLine = text.trim().split("\n").filter(Boolean).slice(0, 3).join("\n");
  return oneLine.length > 600 ? `${oneLine.slice(0, 599)}…` : oneLine;
}

/**
 * The orchestration collector: ask the server how the run ended.
 *
 * Two calls, one session: orchestration_events (after: 0) proves the run is ours
 * and alive in the log; orchestration_status carries the verdict. A terminal state
 * becomes the outcome — succeeded is done (recordResult still checks the gate),
 * every other terminal state is failed. A live run is `{ ok:true, pending:true }`:
 * collection is a read, not a wait.
 */
export async function collectOrchestration(id, { caps = null, p = paths(), spawnImpl, timeoutMs = COLLECT_TIMEOUT_MS, env = process.env } = {}) {
  try {
    const task = read(id, p);
    if (!task) return { ok: false, reason: `not found: ${id}` };
    const handle = String(task.dispatched?.run || "");
    const runId = handle.replace(/^orchestration:/, "");
    if (!runId || runId === handle) return { ok: false, reason: `${id} has no orchestration run id (dispatched.run: ${handle || "none"})` };

    const report = caps ?? detectHostCaps();
    const entry = report?.backends?.orchestration;
    if (!entry?.available || !entry.path) {
      return { ok: false, reason: entry?.reason ?? "orchestration backend is not available on this host" };
    }

    const res = await rpcSession({
      bin: process.execPath,
      argv: [entry.path],
      env,
      timeoutMs,
      spawnImpl,
      label: "orchestration MCP",
      calls: [
        { name: "orchestration_events", arguments: { consumerCwd: p.root, runId, after: 0 } },
        { name: "orchestration_status", arguments: { consumerCwd: p.root, runId } },
      ],
    });
    if (!res.ok) return { ok: false, reason: res.reason };

    const run = envelopeData(res.results[1])?.run;
    if (!run) return { ok: false, reason: `orchestration_status returned no run for ${runId}` };
    if (!ORCH_TERMINAL.has(run.state)) return { ok: true, pending: true, state: run.state };

    const outcome = run.state === "succeeded" ? "done" : "failed";
    const summary = outcome === "done" ? summarizeRun(run) : `run ended ${run.state}: ${summarizeRun(run)}`;
    return recordResult(id, { run: handle, outcome, summary }, p);
  } catch (err) {
    return { ok: false, reason: `collectOrchestration failed for ${id}: ${err.message}` };
  }
}

/**
 * The tmux collector: the session IS the worker's liveness.
 *
 * `tmux has-session -t tm-<id>` answers one question — is the pane still there.
 * Alive means the worker is still running: `{ ok:true, pending:true }`, nothing to
 * record. Gone means the worker exited, and then the task's own status is the
 * verdict: done means it closed through the gates before exiting; still
 * in_progress means it walked away, which is a failure with the reason named.
 */
export function collectTmux(id, { p = paths(), spawnImpl = spawnSync } = {}) {
  try {
    const task = read(id, p);
    if (!task) return { ok: false, reason: `not found: ${id}` };
    const handle = String(task.dispatched?.run || "");
    const session = handle.replace(/^tmux:/, "");
    if (!session || session === handle) return { ok: false, reason: `${id} has no tmux run (dispatched.run: ${handle || "none"})` };

    const res = spawnImpl("tmux", ["has-session", "-t", session], { shell: false, stdio: "ignore" });
    if (res?.error) return { ok: false, reason: `tmux has-session failed: ${res.error.message}` };
    if (res?.status === 0) return { ok: true, pending: true };

    const after = read(id, p) ?? task;
    if (after.status === "done") {
      return recordResult(id, { run: handle, outcome: "done", summary: "tmux worker exited; the task was closed through the gates" }, p);
    }
    if (after.status === "in_progress") {
      return recordResult(id, { run: handle, outcome: "failed", summary: "worker exited without closing" }, p);
    }
    // Parked/blocked/reopened already — the board was told by another path.
    return { ok: true, pending: false, skipped: `task is ${after.status}; nothing to collect` };
  } catch (err) {
    return { ok: false, reason: `collectTmux failed for ${id}: ${err.message}` };
  }
}

/** claude-sessions sits next to spawn-claude-feature; on PATH as the fallback. */
function fleetSessionsBin(caps) {
  const spawnBin = caps?.backends?.fleet?.path;
  if (spawnBin) {
    const sibling = join(dirname(spawnBin), "claude-sessions");
    if (existsSync(sibling)) return sibling;
  }
  return "claude-sessions";
}

/**
 * The fleet collector: read the ticket's event tail for a terminal kind.
 *
 * `claude-sessions events <ticket> --json` prints one {ts, ticket, depth, kind,
 * detail} per line and exits 0 with no output when the ticket has no events —
 * silence is pending, not an error. The LAST terminal event wins: a ticket that
 * errored and then merged ended merged.
 */
export function collectFleet(id, { caps = null, p = paths(), spawnImpl = spawnSync, bin = null, timeoutMs = COLLECT_TIMEOUT_MS } = {}) {
  try {
    const task = read(id, p);
    if (!task) return { ok: false, reason: `not found: ${id}` };
    const handle = String(task.dispatched?.run || "");
    const ticket = handle.replace(/^fleet:/, "");
    if (!ticket || ticket === handle) return { ok: false, reason: `${id} has no fleet run (dispatched.run: ${handle || "none"})` };

    const res = spawnImpl(bin ?? fleetSessionsBin(caps ?? detectHostCaps()), ["events", ticket, "--json"], {
      shell: false,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    if (res?.error) return { ok: false, reason: `claude-sessions events failed: ${res.error.message}` };
    if (res?.status !== 0) {
      return { ok: false, reason: `claude-sessions events exited ${res?.status ?? "?"}: ${String(res?.stderr || "").trim()}` };
    }

    const events = String(res.stdout || "")
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null; // a torn line must not cost the tail
        }
      })
      .filter(Boolean);
    const terminal = [...events].reverse().find((e) => e.kind in FLEET_TERMINAL);
    if (!terminal) return { ok: true, pending: true };

    const outcome = FLEET_TERMINAL[terminal.kind];
    const detail = Object.entries(terminal.detail || {})
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    const summary = `fleet worker signalled ${terminal.kind}${detail ? ` (${detail})` : ""}`;
    return recordResult(id, { run: handle, outcome, summary }, p);
  } catch (err) {
    return { ok: false, reason: `collectFleet failed for ${id}: ${err.message}` };
  }
}

/**
 * Collect whatever backend the task was dispatched to. The dispatched record is
 * the routing table; a task that was never dispatched, or whose backend has no
 * collector (manual work has no worker to hear from), is a refusal, not an error.
 *
 * `impls` overrides the routing table in tests — the seam that proves routing
 * without a live backend.
 */
export async function collect(id, p = paths(), impls = {}) {
  try {
    const task = read(id, p);
    if (!task) return { ok: false, reason: `not found: ${id}` };
    const backend = task.dispatched?.backend;
    if (!backend) return { ok: false, reason: `${id} was never dispatched — there is no worker result to collect` };
    const routes = { orchestration: collectOrchestration, tmux: collectTmux, fleet: collectFleet, ...impls };
    const route = routes[backend];
    if (!route) return { ok: false, reason: `no collector for backend "${backend}"` };
    return route(id, { p });
  } catch (err) {
    return { ok: false, reason: `collect failed for ${id}: ${err.message}` };
  }
}
