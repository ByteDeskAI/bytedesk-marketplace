/**
 * collect: turn a dispatched worker's completion into store truth.
 *
 * dispatch (./index.mjs) starts the worker and records `dispatched:{backend,run,...}`
 * on the task. What it cannot do is know how that worker ENDED — each backend has a
 * different completion signal: an ACP run reaches a terminal state, a raw tmux
 * session disappears, or topology observes an exact native incarnation. The collectors normalize each into
 * one call to `recordResult`, which is the protocol's single write path.
 *
 * The protocol's invariants, all enforced in recordResult rather than in the
 * collectors:
 *
 *   1. A collector never closes a task. Governed workers submit a producer finish and
 *      keep their claim for review; completion requires authorized integration. An
 *      ungoverned worker reporting done before passing `tm done` is recorded as failed.
 *   2. Failure parks an in_progress task and releases its claim unless the governed
 *      revision was already submitted for review. That ownership and evidence persist.
 *      A task-scoped failure first reopens the task for up to dispatch.retries retries
 *      with backoff (retryPlan, TM-363); only then does it park.
 *   3. Everything is recorded: the summary lands as a comment and one `task_result`
 *      event ({ id, run, outcome }) lands in the log, so `tm log` tells the story.
 *   4. Fire-and-forget safe. Every function here is bounded and never throws — a
 *      collector that throws takes down whatever hook or sweep called it, so
 *      failures come back as `{ ok: false, reason }`.
 */
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { toolFailureReason } from "./backend.mjs";
import { claimant, releaseClaim } from "../claims.mjs";
import { addComment } from "../issue.mjs";
import { detectHostCaps } from "../hostcaps.mjs";
import { withoutAoIdentity } from "../actor.mjs";
import { config, logEvent, mutate, now, read, update } from "../store.mjs";
import { paths } from "../paths.mjs";
import { rpcSession } from "./mcp-client.mjs";
import { failureScope } from "./failure.mjs";
import { managementIdentity, readManagementRecord } from "../governance-check.mjs";
import { safeGitSync } from "../safe-git.mjs";

/** A collection is a quick query, not the 120s launch handshake. */
export const COLLECT_TIMEOUT_MS = 30_000;

/** Asking `gh` for a PR url is a nicety on the way past; it never holds up a collection. */
export const PR_LOOKUP_TIMEOUT_MS = 5_000;

const OUTCOMES = new Set(["done", "ready-for-review", "blocked", "failed"]);

/**
 * The result last recorded for the task's CURRENT dispatch, or null (TM-238, TM-303).
 * The ready-for-review path changes no state, so without this the pool re-collected the same
 * exited worker every tick: 575 identical comments and events on TM-290. The stamp is keyed on
 * `dispatched.at` (every record has it) plus `run` when present, so a dispatch with no run handle
 * is de-duplicated too, and a re-dispatch — a new record — is collected again.
 */
export function priorCollection(task) {
  const d = task?.dispatched;
  const c = d?.collected;
  return c && c.dispatchedAt === (d.at ?? null) && c.run === (d.run ?? null) ? c : null;
}

/** Orchestration's TERMINAL_STATES (agent-orchestration/src/state/store.mjs). */
const ORCH_TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out", "rejected", "recovery_required"]);

/**
 * The PR a finished worker left behind, recorded on the task (TM-180).
 *
 * The handoff now ends the worker's run at a pushed branch and an open PR, so the board
 * should carry the link. It goes in `commits` — the array `tm link <id> <ref>` already
 * writes, `tm show` already prints and the handoff already renders as "Commits / PRs" —
 * rather than a field invented for it.
 *
 * Never throws, never fails a collection, never waits long: a missing `gh`, an
 * unauthenticated one, a branch with no PR and a slow network all record nothing and move
 * on. The link is a convenience; losing a worker's result to fetch one would be the wrong
 * trade. `exec` is the seam the tests drive — real `gh` is never run in a unit test.
 */
function recordPullRequest(task, p, exec) {
  try {
    const branch = String(task.branch || "").trim();
    if (!branch) return null;
    const res = exec("gh", ["pr", "list", "--head", branch, "--json", "url", "--jq", ".[0].url"], {
      shell: false,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: PR_LOOKUP_TIMEOUT_MS,
    });
    if (res?.error || res?.status !== 0) return null;
    const url = String(res.stdout || "").trim();
    if (!/^https:\/\/\S+$/.test(url)) return null;
    if ((task.commits || []).includes(url)) return url;
    mutate(task.id, (doc) => ({ commits: [...new Set([...(doc.commits || []), url])] }), p);
    return url;
  } catch {
    return null;
  }
}

/**
 * The uncommitted paths a failed worker left in its worktree (TM-246), or [].
 *
 * "worker exited without closing" said nothing about whether work was lost; TM-240 was parked
 * with four uncommitted files and no commit, and nobody could tell from the board. Every
 * collector's failure goes through recordResult, so the paths are read once here, for all of
 * them. Bounded and never throws: no worktree, no git, or a removed checkout records nothing.
 */
function dirtyPaths(worktree) {
  if (!worktree || !isAbsolute(String(worktree))) return [];
  try {
    const res = safeGitSync(worktree, ["status", "--porcelain", "--untracked-files=all"], { timeout: 5_000 }); // TM-443
    if (res.error || res.status !== 0) return [];
    return String(res.stdout || "").split("\n").filter(Boolean).map((line) => line.slice(3));
  } catch {
    return [];
  }
}

/**
 * Whether a failed worker earns another attempt instead of parking (TM-363), as
 * { attempt, retries, retryAt }, or null.
 *
 * Only a task-scoped failure of a running, ungoverned-or-unsubmitted task qualifies: a
 * provider or backend failure parks as before and still feeds the pool's brake, and a
 * worker that said `blocked` is asking for a person. Backoff is 1, 4, 16… minutes
 * (4^(attempt-1)) and the count lives on the task, so it caps retries over the task's life.
 * ponytail: lifetime count, never reset; reset on a later success if reopened work needs fresh retries.
 */
function retryPlan(task, final, scope, reviewReady, p) {
  if (final !== "failed" || scope !== "task" || reviewReady || task.status !== "in_progress") return null;
  const retries = Number(config(p).dispatch?.retries ?? 2);
  const attempt = (Number(task.dispatchRetries) || 0) + 1;
  if (!(attempt <= retries)) return null;
  return { attempt, retries, retryAt: new Date(Date.now() + 4 ** (attempt - 1) * 60_000).toISOString() };
}

/**
 * TM-247: a governed task whose live claim belongs to its admission owner is that lead's to recover.
 * The collector records what the worker did and leaves the task, claim and status alone; parking
 * here dropped a lead's re-claim between ticks (TM-242) and forced a manual TM_SESSION_ID tm start.
 *
 * TM-460: the dispatch itself claims under the admission owner (AC13), so "the owner holds the
 * claim" was true for EVERY governed dispatch, and a worker that crashed after its lead was gone
 * was never parked or retried. The owner's claim counts only when agent-orchestration proves the
 * lead responsive from proof already on disk (`lead status --cached`: no probe, no ring, no wait).
 * A re-claim is NOT evidence: the worker carries the lead's TM_SESSION_ID, so it can produce one
 * (`env -u TM_DISPATCH_WORKER tm start`, or the dashboard API in the lead's process). The claim's
 * `worker`/`since` fields stay as information only. No ao, no proof: not held.
 */
function heldByAdmissionOwner(task, p, { caps = null, exec = spawnSync } = {}) {
  if (!task.governance) return false;
  try {
    const { record } = readManagementRecord(task, p);
    const claim = claimant(task.id, p);
    if (!record.owner || claim?.session !== record.owner) return false;
    return leadProvenAlive(record.lead_id || record.owner, p, { caps, exec });
  } catch {
    return false;
  }
}

function leadProvenAlive(leadId, p, { caps, exec }) {
  const bin = caps ? caps.backends?.topology?.path : detectHostCaps().backends?.topology?.path;
  if (!bin) return false;
  const res = exec(bin, ["lead", "status", "--cached"], { cwd: p.root, env: withoutAoIdentity(process.env), shell: false, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: PR_LOOKUP_TIMEOUT_MS });
  if (res?.error) return false;
  const status = JSON.parse(String(res.stdout || "{}"));
  return status.status === "responsive" && status.record?.agent_id === leadId;
}

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
export function recordResult(id, result = {}, p = paths(), { exec = spawnSync, caps = null } = {}) {
  try {
    const { run = null, outcome, summary = "" } = result ?? {};
    const task = read(id, p);
    if (!task) return { ok: false, reason: `not found: ${id}` };
    if (!task.dispatched) {
      return { ok: false, reason: `${id} was never dispatched — there is no worker result to record` };
    }
    if (!OUTCOMES.has(outcome)) return { ok: false, reason: `unknown outcome: ${outcome}` };
    if (run && run !== task.dispatched.run) return { ok: false, reason: "worker result belongs to an earlier or different dispatch", failureScope: "task" };
    let final = outcome;
    let note = String(summary || "").trim();
    const reviewReady = task.governance?.state === "ready-for-review";
    if (final === "done" && reviewReady) final = "ready-for-review";
    if (final === "ready-for-review" && !reviewReady) return { ok: false, reason: "the task has not submitted its exact revision for independent review", failureScope: "task" };

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

    // Only a TRUE repeat is a no-op: same dispatch, same outcome. A different outcome for the same
    // run (blocked after ready-for-review) is news and is recorded like any other result.
    if (priorCollection(task)?.outcome === final) return { ok: true, id, outcome: final, duplicate: true, downgraded: false, parked: false };

    let parked = false;
    const scope = failureScope({ ...result, summary: note });
    // After the scope is read, so a file name cannot change how the failure is classified (TM-246).
    if (final === "failed") {
      const dirty = dirtyPaths(task.worktree);
      if (dirty.length) note = `${note || "worker failed"}\n\nuncommitted in ${task.worktree}: ${dirty.slice(0, 20).join(", ")}${dirty.length > 20 ? ` (+${dirty.length - 20} more)` : ""}`;
    }
    const leadHeld = heldByAdmissionOwner(task, p, { caps, exec });
    const retry = leadHeld ? null : retryPlan(task, final, scope, reviewReady, p);
    if (leadHeld) {
      /* the admission owner recovers it: manage stop-worker retires the worker, start-worker replaces it */
    } else if (retry) {
      // Reopened, not parked: the claim goes so the pool can pick it up once retryAt passes.
      update(id, { status: "open", dispatchRetries: retry.attempt, retryAt: retry.retryAt }, p);
      releaseClaim(id, p);
      logEvent("dispatch_retry", { id, run: task.dispatched.run ?? null, ...retry, reason: note.split("\n")[0].slice(0, 300) }, p);
    } else if ((final === "blocked" || final === "failed") && task.status === "in_progress" && !reviewReady) {
      update(id, { status: "parked", parkedReason: note || `worker ${final}` }, p);
      releaseClaim(id, p);
      parked = true;
    }

    // A genuine done ends at a PR (TM-180). Asked for only on the done path, and only ever
    // additive: `pr` is absent when there is nothing to record, never a reason to fail.
    const pr = ["done", "ready-for-review"].includes(final) ? recordPullRequest(task, p, exec) : null;

    if (note) addComment(id, note, { author: `worker:${task.dispatched.backend}`, p });
    mutate(id, (doc) => ({ dispatched: { ...doc.dispatched, collected: { dispatchedAt: task.dispatched.at ?? null, run: task.dispatched.run ?? null, outcome: final, at: now() } } }), p);
    // `pr` rides on the event so a ticket's origin hears "PR opened" (TM-359, lib/ticket.mjs).
    logEvent("task_result", { id, run: task.dispatched.run ?? null, outcome: final, ...(pr ? { pr } : {}) }, p);
    // summary rides along so the pool's brake can see a quota-shaped failure (TM-175).
    return { ok: true, id, outcome: final, downgraded: final !== outcome, parked, ...(leadHeld ? { heldByLead: true } : {}), summary: note, failureScope: scope, ...(retry ? { retry } : {}), ...(pr ? { pr } : {}) };
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

    /**
     * Ask with the SAME consumer the dispatch spawned with, or the server refuses its
     * own run. Orchestration's authority is checkout-scoped — `repositoryKey =
     * sha256(commonGitDir\0checkoutRoot)` (agent-orchestration/src/workspace/
     * repository.mjs) — and a linked worktree is its own `--show-toplevel`, so the
     * repo root hashes to a different key than the worktree dispatch handed over
     * (dispatch/orchestration.mjs, `consumerCwd: req.worktree`). `getRun` re-derives
     * the key on every read and refuses a mismatch with AO_RUN_REPOSITORY_MISMATCH,
     * which made the dispatch → collect round trip fail for every orchestration run.
     *
     * The task's own `worktree` field IS that value: provision() records the path it
     * created and dispatch passes the same one to the backend, so nothing new has to
     * be written down at dispatch time to make collect agree with spawn. The repo
     * root remains the fallback for a record from before worktrees, or one whose
     * checkout has since been removed.
     */
    const consumerCwd = task.worktree || p.root;

    const res = await rpcSession({
      bin: process.execPath,
      argv: [entry.path],
      env,
      timeoutMs,
      spawnImpl,
      label: "orchestration MCP",
      calls: [
        { name: "orchestration_events", arguments: { consumerCwd, runId, after: 0 } },
        { name: "orchestration_status", arguments: { consumerCwd, runId } },
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
 * The raw-tmux collector. Native topology uses the producer's exact observation below.
 *
 * `tmux has-session -t <session>` answers one question — is the pane still there.
 * Alive means the worker is still running: `{ ok:true, pending:true }`, nothing to
 * record. Gone means the worker exited, and then the task's own status is the
 * verdict: done means it closed through the gates before exiting; still
 * in_progress means it walked away, which is a failure with the reason named.
 *
 * Raw tmux puts its session name after the backend prefix in the dispatched handle.
 */
function collectSession(id, backend, { p = paths(), spawnImpl = spawnSync, caps = null } = {}) {
  try {
    const task = read(id, p);
    if (!task) return { ok: false, reason: `not found: ${id}` };
    const handle = String(task.dispatched?.run || "");
    const prefix = `${backend}:`;
    const session = handle.startsWith(prefix) ? handle.slice(prefix.length) : "";
    if (!session) return { ok: false, reason: `${id} has no ${backend} run (dispatched.run: ${handle || "none"})` };

    const res = spawnImpl("tmux", ["has-session", "-t", session], { shell: false, stdio: "ignore" });
    if (res?.error) return { ok: false, reason: `tmux has-session failed: ${res.error.message}` };
    if (res?.status === 0) return { ok: true, pending: true };

    const after = read(id, p) ?? task;
    if (after.governance?.state === "ready-for-review") {
      return recordResult(id, { run: handle, outcome: "ready-for-review", summary: `${backend} worker exited after submitting its revision; independent review and integration remain required` }, p);
    }
    if (after.status === "done") {
      return recordResult(id, { run: handle, outcome: "done", summary: `${backend} worker exited; the task was closed through the gates` }, p);
    }
    if (after.status === "in_progress") {
      return recordResult(id, { run: handle, outcome: "failed", summary: "worker exited without closing" }, p, { caps });
    }
    if (after.status === "blocked") return recordBlocked(id, handle, after, `${backend} worker`, p);
    // Parked/blocked/reopened already — the board was told by another path.
    return { ok: true, pending: false, skipped: `task is ${after.status}; nothing to collect` };
  } catch (err) {
    return { ok: false, reason: `collect${backend[0].toUpperCase()}${backend.slice(1)} failed for ${id}: ${err.message}` };
  }
}

/**
 * TM-247: a worker that ran `tm block` and exited reported a blocker, not nothing. Its reason is the
 * collected result, once per dispatch, so the board and the duplicate-dispatch guard both see it ended.
 */
function recordBlocked(id, run, task, who, p) {
  if (priorCollection(task)?.outcome === "blocked") return { ok: true, pending: false, duplicate: true, outcome: "blocked" };
  return recordResult(id, { run, outcome: "blocked", summary: `${who} exited blocked: ${task.blockedReason || "no reason given"}` }, p);
}

/** The raw-tmux collector: `tmux:tm-<id>`. */
export function collectTmux(id, opts = {}) {
  return collectSession(id, "tmux", opts);
}

function reconcileTopologyReference(task, { p, ask, env }) {
  const dispatched = task.dispatched;
  const sourcePath = dispatched.legacyRecordPath || (isAbsolute(dispatched.runDir || "") ? join(dispatched.runDir, "run.json") : null) || dispatched.recordPath;
  if (!isAbsolute(sourcePath || "")) throw new Error(`${task.id} has no durable topology record reference; reconcile and import its native workflow before collection`);
  const result = ask(["console", "list", "--consumer", p.root, "--json"]);
  if (result?.error || result?.status !== 0) throw new Error(result?.error?.message || toolFailureReason("ao-topology console list", result));
  const index = JSON.parse(String(result.stdout || "")), repoId = managementIdentity(task.id, p, env).repoId;
  if (index.schemaVersion !== 1 || index.repository?.id !== repoId || !Array.isArray(index.workflows)) throw new Error("native workflow discovery did not verify this repository");
  const samePath = (path, expected) => isAbsolute(path || "") && resolve(path) === resolve(expected);
  // The producer validates and imports surviving records. Only the exact previously
  // recorded path can reconnect a task; task names and transcript claims are not handles.
  const matches = index.workflows.filter((entry) => entry.runtime === "topology" &&
    (samePath(entry.recordPath, sourcePath) || samePath(entry.legacySourcePath, sourcePath)));
  if (matches.length !== 1) throw new Error(`native workflow reference is ${matches.length ? "ambiguous" : "missing"} in producer discovery; preserve its task and worktree`);
  const entry = matches[0];
  if ((index.rejected || []).some((item) => samePath(item.path, sourcePath) || samePath(item.path, entry.recordPath))) throw new Error("producer rejected the recorded native workflow; preserve its task and worktree");
  if (entry.repositoryId !== repoId || entry.taskId !== task.id || !entry.nativeRunId || entry.workflowId !== `topology:${entry.nativeRunId}` ||
    !isAbsolute(entry.recordPath || "") || !isAbsolute(task.worktree || "") || !samePath(entry.workloadCwd, task.worktree) ||
    (dispatched.nativeRunId && dispatched.nativeRunId !== entry.nativeRunId)) throw new Error("native workflow identity does not match the task, repository, or recorded workload checkout");
  const next = {
    ...dispatched, nativeRunId: entry.nativeRunId, workflowRunId: entry.workflowId, recordPath: entry.recordPath,
    ...(entry.legacySourcePath ? { legacyRecordPath: entry.legacySourcePath } : {}),
  };
  if (JSON.stringify(next) === JSON.stringify(dispatched)) return dispatched;
  mutate(task.id, (current) => {
    if (JSON.stringify(current.dispatched) !== JSON.stringify(dispatched) || current.worktree !== task.worktree) throw new Error("task dispatch changed during native reference reconciliation; retry collection");
    return { dispatched: next };
  }, p);
  logEvent("dispatch_reconciled", { id: task.id, nativeRunId: entry.nativeRunId, recordPath: entry.recordPath, sourcePath }, p);
  return next;
}

/** TM-417: a dispatch recorded before `topology:<native run id>` was canonical carries the bare run id. */
const miscanonical = (dispatched) => Boolean(dispatched.nativeRunId && dispatched.workflowRunId && dispatched.workflowRunId !== `topology:${dispatched.nativeRunId}`);

function topologyProducer({ caps, spawnImpl, timeoutMs, env }) {
  const entry = (caps || detectHostCaps()).backends?.topology;
  if (!entry?.available || !entry.path) return null;
  return (args) => spawnImpl(entry.path, args, {
    shell: false, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024,
  });
}

/**
 * TM-417: `tm rebind <id>` — repair a topology dispatch whose workflow id is not the producer's
 * canonical one, through the same producer-verified reconciliation collection uses. Never a worker's
 * call, and never a collection: a live or finished worker keeps its claim and its state.
 */
export function rebindTopology(id, { p = paths(), caps = null, spawnImpl = spawnSync, timeoutMs = COLLECT_TIMEOUT_MS, env = process.env } = {}) {
  if (env.TM_DISPATCH_WORKER) throw new Error("a dispatched worker cannot rebind its own dispatch; the lead runs ao-topology manage rebind");
  const task = read(id, p);
  if (!task) throw new Error(`not found: ${id}`);
  const dispatched = task.dispatched;
  if (!String(dispatched?.run || "").startsWith("topology:") || !dispatched.nativeRunId) throw new Error(`${id} has no topology dispatch with a native run id to rebind`);
  if (!miscanonical(dispatched)) return { rebound: false, dispatched };
  const ask = topologyProducer({ caps, spawnImpl, timeoutMs, env });
  if (!ask) throw new Error("topology producer is unavailable to verify the native workflow");
  const next = reconcileTopologyReference(task, { p, ask, env });
  return { rebound: true, from: dispatched.workflowRunId, to: next.workflowRunId, dispatched: next };
}

/** Native collection requires the producer's exact incarnation observation. */
export function collectTopology(id, { p = paths(), caps = null, spawnImpl = spawnSync, timeoutMs = COLLECT_TIMEOUT_MS, env = process.env } = {}) {
  const task = read(id, p);
  let dispatched = task?.dispatched;
  const hold = (reason) => ({ ok: false, reason, failureScope: "task" });
  if (!task) return hold(`not found: ${id}`);
  if (!String(dispatched?.run || "").startsWith("topology:")) return hold(`${id} has no topology run`);
  const unbound = !dispatched.nativeRunId || !isAbsolute(dispatched.recordPath || "");
  if (unbound && !isAbsolute(dispatched.runDir || "") && !isAbsolute(dispatched.legacyRecordPath || "")) return hold(`${id} has no durable topology record reference; reconcile and import its native workflow before collection`);
  const ask = topologyProducer({ caps, spawnImpl, timeoutMs, env });
  if (!ask) return { ok: false, reason: "topology producer is unavailable for exact workflow observation", failureScope: "backend" };
  try {
    if (unbound || miscanonical(dispatched) || (isAbsolute(dispatched.legacyRecordPath || "") && resolve(dispatched.recordPath) === resolve(dispatched.legacyRecordPath))) {
      dispatched = reconcileTopologyReference(task, { p, ask, env });
    }
    const res = ask(["status", "--run", dirname(dispatched.recordPath), "--consumer", p.root, "--json"]);
    if (res?.error || res?.status !== 0) return hold(res?.error?.message || toolFailureReason("ao-topology status", res));
    const observed = JSON.parse(String(res.stdout || ""));
    if (observed.run_id !== dispatched.nativeRunId || observed.observation_error !== null || typeof observed.session_alive !== "boolean") {
      return hold(`topology workflow ownership is unproven: ${observed.observation_error?.message || "missing or mismatched exact incarnation"}`);
    }
    const allDead = Array.isArray(observed.agents) && observed.agents.length > 0 && observed.agents.every((agent) => agent.alive === false);
    if (observed.session_alive && !allDead) return { ok: true, pending: true, state: observed.state };
    const after = read(id, p) || task;
    if (after.governance?.state === "ready-for-review") return recordResult(id, { run: dispatched.run, outcome: "ready-for-review", summary: "native worker ended after submitting its exact revision; independent review and integration remain required" }, p);
    if (after.status === "done") return recordResult(id, { run: dispatched.run, outcome: "done", summary: "native worker ended; task completion was already verified" }, p);
    if (after.status === "in_progress") return recordResult(id, { run: dispatched.run, outcome: "failed", summary: "native worker ended without completing its task protocol" }, p, { caps });
    if (after.status === "blocked") return recordBlocked(id, dispatched.run, after, "native worker", p);
    return { ok: true, pending: false, skipped: `task is ${after.status}; nothing to collect` };
  } catch (error) { return hold(`native workflow observation failed: ${error.message}`); }
}

/**
 * The idle collector: ask the topology layer whether the assigned agent has REPLIED.
 *
 * `idle:<agentId>` is the only handle in the table that does not name a session, because the
 * completion signal is not session death. A standing agent outlives the task — that is the entire
 * point of dispatching into one — so `has-session` would report `pending: true` forever and the
 * board would never learn the work finished. What ends an idle dispatch is the reply to the
 * standing-mailbox assignment, which `ao-topology manage assignment` reads.
 *
 * Everything after that is deliberately the shared path: the reply's first word becomes an
 * outcome, and `recordResult` — unmodified — applies the downgrade rule ("done" for a task the
 * store does not show done is a failure that says so) and the park-never-strand rule byte for byte.
 *
 * A TERMINAL reply also RELEASES the assignment, and it does so whether or not `recordResult`
 * accepted the outcome. The agent's freedom is not conditional on the store's bookkeeping: a reply
 * that arrived means this agent is done with this task, and leaving it bound because a comment
 * could not be written would cost the repository a standing worker permanently.
 */
export function collectIdle(id, { caps = null, p = paths(), spawnImpl = spawnSync, timeoutMs = COLLECT_TIMEOUT_MS, env = process.env } = {}) {
  try {
    const task = read(id, p);
    if (!task) return { ok: false, reason: `not found: ${id}` };
    const handle = String(task.dispatched?.run || "");
    const agentId = handle.startsWith("idle:") ? handle.slice("idle:".length) : "";
    if (!agentId) return { ok: false, reason: `${id} has no idle assignment (dispatched.run: ${handle || "none"})` };

    const report = caps ?? detectHostCaps();
    const entry = report?.backends?.topology;
    if (!entry?.available || !entry.path) {
      return { ok: false, reason: entry?.reason ?? "topology backend is not available on this host, so the assignment cannot be read" };
    }

    // The same consumer the dispatch assigned with. Linked worktrees share one canonical repository
    // id, so this picks the same management record either way; the worktree is preferred only
    // because it is the path the task itself records, and the root is the fallback for a checkout
    // that has since been removed.
    const consumer = task.worktree || p.root;
    const ask = (args) => spawnImpl(entry.path, args, { shell: false, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });

    const res = ask(["manage", "assignment", "--task", id, "--consumer", consumer]);
    if (res?.error) return { ok: false, reason: `ao-topology failed to start: ${res.error.message}` };
    if (res?.status !== 0) {
      return { ok: false, reason: toolFailureReason("ao-topology manage assignment", res) };
    }
    let record;
    try {
      record = JSON.parse(String(res.stdout || ""));
    } catch {
      return { ok: false, reason: `ao-topology manage assignment printed no assignment JSON: ${String(res.stdout || "").trim().slice(-300)}` };
    }
    if (record?.assigned !== true) {
      return { ok: true, pending: false, skipped: record?.reason ?? `${id} has no live idle assignment; nothing to collect` };
    }
    if (record.pending === true) return { ok: true, pending: true, agent: record.agent_id ?? agentId };
    if (!OUTCOMES.has(record.outcome)) {
      return { ok: false, reason: `ao-topology manage assignment reported an unknown outcome for ${id}: ${JSON.stringify(record.outcome)}` };
    }

    const recorded = recordResult(id, { run: handle, outcome: record.outcome, summary: String(record.summary || "").trim() }, p, { caps });
    // Release AFTER recording, so the agent is never free while the board still says nobody
    // reported — and unconditionally, so a refused recording cannot strand it. Its own failure is
    // reported alongside rather than replacing the result: two facts, both true.
    const released = ask(["manage", "release", "--task", id, "--consumer", consumer, "--reason", `collected: ${record.outcome}`]);
    const releaseFailed = released?.error ? released.error.message : released?.status !== 0 ? String(released?.stderr || "").trim() : null;
    return { ...recorded, agent: record.agent_id ?? agentId, released: !releaseFailed, ...(releaseFailed ? { releaseReason: releaseFailed } : {}) };
  } catch (err) {
    return { ok: false, reason: `collectIdle failed for ${id}: ${err.message}` };
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
    // A blocked/parked/done task whose dispatch was already collected has nothing left to hear:
    // no backend probe, no release, no comment, no event. An in-progress one is still probed, and
    // recordResult drops a repeat of the same outcome while recording a changed one.
    const prior = priorCollection(task);
    if (prior && task.status !== "in_progress") return { ok: true, pending: false, duplicate: true, outcome: prior.outcome, skipped: `${task.dispatched.run ?? backend} was already collected (${prior.outcome}); nothing to collect` };
    const routes = { topology: collectTopology, orchestration: collectOrchestration, tmux: collectTmux, idle: collectIdle, ...impls };
    const route = routes[backend];
    if (!route) return { ok: false, reason: `no collector for backend "${backend}"` };
    const res = await route(id, { p });
    if (res?.ok && res.pending) noteOverrun(task, p);
    return res;
  } catch (err) {
    return { ok: false, reason: `collect failed for ${id}: ${err.message}` };
  }
}

/**
 * A worker still running past dispatch.maxRuntimeMinutes (default 120; 0 disables) is
 * logged once as `worker_overrun` (TM-175). Visibility, never a park: a long task is
 * not a failed one. "Once" is stamped on the dispatch record, so a re-dispatch, which
 * writes a fresh record, starts a fresh clock. Never throws: it must not turn a pending
 * result into a failed collection.
 */
function noteOverrun(task, p) {
  try {
    const d = task.dispatched;
    const limit = Number(config(p).dispatch?.maxRuntimeMinutes ?? 120);
    if (!(limit > 0) || !d?.at || d.overrunAt) return;
    const minutes = (Date.now() - new Date(d.at).getTime()) / 60_000;
    if (!(minutes > limit)) return;
    mutate(task.id, (doc) => ({ dispatched: { ...doc.dispatched, overrunAt: now() } }), p);
    logEvent("worker_overrun", { id: task.id, backend: d.backend, run: d.run ?? null, minutes: Math.round(minutes), limit }, p);
  } catch {
    /* visibility only */
  }
}
