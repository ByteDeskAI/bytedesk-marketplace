/**
 * The result protocol: how a dispatched worker's completion becomes store truth.
 *
 * recordResult is the single write path — the AC gate stays the real gate (a
 * "done" report for a task that is not done downgrades to failed), failure parks
 * and releases the claim, and everything lands as a comment plus one task_result
 * event. The collectors normalize each backend's completion signal into it:
 * tmux against a stubbed spawnImpl, orchestration against the fake MCP server
 * (fixtures/fake-orchestration-mcp.mjs).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addWorktree, cleanup, tempRepo, tempStore } from "./helpers.mjs";
import { handoff } from "../../lib/render.mjs";
import { create, mutate, now, read, readEvents, seedGitContract, state, update, writeConfig, writeState } from "../../lib/store.mjs";
import { collect, collectOrchestration, collectTmux, collectTopology, rebindTopology, recordResult } from "../../lib/dispatch/collect.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { poolTick } from "../../lib/dispatch/pool.mjs";
import { managementIdentity } from "../../lib/governance-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_SERVER = join(HERE, "fixtures", "fake-orchestration-mcp.mjs");

const stores = [];
/** `retries` is 0 so these cases pin the park path; the retry cases set their own (TM-363). */
function store({ retries = 0 } = {}) {
  const p = tempStore();
  writeConfig({ dispatch: { retries } }, p);
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const SESSION = "lead-session";

/** The run handle each backend really records on the task. */
const RUN_SHAPES = {
  tmux: (id) => `tmux:tm-${id}`,
  topology: (id) => `topology:${id.toLowerCase()}-20260905-120000-abcd`,
  orchestration: (id) => `orchestration:${id}`,
};

/** A task exactly as dispatch left it: dispatched record, status, claim. */
function dispatched(p, { backend = "tmux", run = null, status = "in_progress", claim = true, ...fields } = {}) {
  const t = create("task", { title: "dispatched work", ...fields }, "", p);
  const handle = run ?? (RUN_SHAPES[backend]?.(t.id) || `${backend}:${t.id}`);
  mutate(t.id, () => ({ dispatched: { backend, run: handle, session: SESSION, at: now() } }), p);
  update(t.id, { status }, p);
  if (claim) {
    const claims = { ...state(p).claims, [t.id]: { session: SESSION, actor: "main", pid: 1, ts: now() } };
    writeState({ claims }, p);
  }
  return t.id;
}

/** A spawnImpl that records its argv and answers from a can. */
function spawnReturning(res) {
  const fn = (...callArgs) => {
    fn.calls.push(callArgs);
    return res;
  };
  fn.calls = [];
  return fn;
}

const results = (p) => readEvents(p).filter((e) => e.event === "task_result");
const lastComment = (p, id) => (read(id, p).comments || []).at(-1)?.text || "";
const claimed = (p, id) => Boolean(state(p).claims?.[id]);

describe("recordResult — the done report must be true", () => {
  it("records a genuine done: the worker closed through the gates", () => {
    const p = store();
    const id = dispatched(p, { status: "done", claim: false });
    const res = recordResult(id, { outcome: "done", summary: "all acceptance criteria verified, tests attached" }, p);

    assert.equal(res.ok, true);
    assert.equal(res.outcome, "done");
    assert.equal(res.downgraded, false);
    assert.equal(res.parked, false);
    assert.match(lastComment(p, id), /all acceptance criteria verified/);
    assert.deepEqual(results(p).map((e) => [e.id, e.outcome]), [[id, "done"]]);
  });

  it("downgrades a done report when the task is not done — the AC gate is the gate", () => {
    const p = store();
    const id = dispatched(p, { status: "in_progress" });
    const res = recordResult(id, { outcome: "done", summary: "claims it works" }, p);

    assert.equal(res.ok, true);
    assert.equal(res.outcome, "failed", "a false done is a failure, not a close");
    assert.equal(res.downgraded, true);

    const task = read(id, p);
    assert.equal(task.status, "parked", "failure parks — never leaves the task in_progress");
    assert.match(task.parkedReason, /claims it works/);
    assert.match(task.parkedReason, /worker reported done but task is in_progress/);
    assert.equal(claimed(p, id), false, "the claim is released with the park");
    assert.deepEqual(results(p).map((e) => e.outcome), ["failed"], "the event records the downgrade, not the claim");
  });
});

describe("recordResult — blocked and failed park, never strand", () => {
  it("blocked parks with the summary as the reason and releases the claim", () => {
    const p = store();
    const id = dispatched(p);
    const res = recordResult(id, { outcome: "blocked", summary: "needs the vendor API key" }, p);

    assert.equal(res.ok, true);
    assert.equal(res.outcome, "blocked");
    assert.equal(res.parked, true);
    assert.equal(read(id, p).status, "parked");
    assert.equal(read(id, p).parkedReason, "needs the vendor API key");
    assert.equal(claimed(p, id), false);
    assert.match(lastComment(p, id), /needs the vendor API key/);
    assert.deepEqual(results(p).map((e) => [e.id, e.run, e.outcome]), [[id, `tmux:tm-${id}`, "blocked"]]);
  });

  it("failed parks the same way, with a fallback reason when the summary is empty", () => {
    const p = store();
    const id = dispatched(p);
    const res = recordResult(id, { outcome: "failed" }, p);

    assert.equal(res.ok, true);
    assert.equal(read(id, p).status, "parked");
    assert.equal(read(id, p).parkedReason, "worker failed");
    assert.equal(claimed(p, id), false);
  });

  it("does not re-park a task that already left in_progress", () => {
    const p = store();
    const id = dispatched(p, { status: "done", claim: false });
    const res = recordResult(id, { outcome: "failed", summary: "crashed after closing" }, p);
    assert.equal(res.ok, true);
    assert.equal(res.parked, false);
    assert.equal(read(id, p).status, "done", "a closed task stays closed");
  });
});

describe("recordResult — refusals and garbage", () => {
  it("refuses a task that does not exist", () => {
    const res = recordResult("TM-404", { outcome: "done" }, store());
    assert.equal(res.ok, false);
    assert.match(res.reason, /not found/);
  });

  it("refuses a task that was never dispatched", () => {
    const p = store();
    const t = create("task", { title: "manual work" }, "", p);
    const res = recordResult(t.id, { outcome: "done" }, p);
    assert.equal(res.ok, false);
    assert.match(res.reason, /never dispatched/);
  });

  it("refuses an outcome it does not know, changing nothing", () => {
    const p = store();
    const id = dispatched(p);
    const res = recordResult(id, { outcome: "splendid" }, p);
    assert.equal(res.ok, false);
    assert.match(res.reason, /unknown outcome/);
    assert.equal(read(id, p).status, "in_progress", "a refused record changes nothing");
    assert.equal(results(p).length, 0);
  });

  it("never throws, on any garbage", () => {
    const p = store();
    assert.equal(recordResult(null, null, p).ok, false);
    assert.equal(recordResult(undefined, {}, p).ok, false);
    assert.equal(recordResult("TM-404", { outcome: 42 }, p).ok, false);
  });
});

describe("collectTmux — the session is the liveness signal", () => {
  it("asks argv-only, and a live session means pending — nothing to record", () => {
    const p = store();
    const id = dispatched(p, { backend: "tmux" });
    const spawn = spawnReturning({ status: 0 });

    const res = collectTmux(id, { p, spawnImpl: spawn });
    assert.deepEqual(res, { ok: true, pending: true });

    const [bin, args, opts] = spawn.calls[0];
    assert.equal(bin, "tmux");
    assert.deepEqual(args, ["has-session", "-t", `tm-${id}`], "exact argv, no shell string");
    assert.equal(opts.shell, false);
    assert.equal(results(p).length, 0, "a running worker records nothing");
  });

  it("session gone + task done = done", () => {
    const p = store();
    const id = dispatched(p, { backend: "tmux", status: "done", claim: false });
    const res = collectTmux(id, { p, spawnImpl: spawnReturning({ status: 1 }) });
    assert.equal(res.ok, true);
    assert.equal(res.outcome, "done");
    assert.deepEqual(results(p).map((e) => e.outcome), ["done"]);
  });

  it("session gone + still in_progress = the worker walked away", () => {
    const p = store();
    const id = dispatched(p, { backend: "tmux" });
    const res = collectTmux(id, { p, spawnImpl: spawnReturning({ status: 1 }) });

    assert.equal(res.ok, true);
    assert.equal(res.outcome, "failed");
    assert.equal(read(id, p).status, "parked");
    assert.equal(read(id, p).parkedReason, "worker exited without closing");
    assert.equal(claimed(p, id), false);
  });

  it("session gone + uncommitted work = the dirty paths are in the reason (TM-246)", () => {
    const p = store();
    const repo = tempRepo();
    writeFileSync(join(repo, "README.md"), "# edited\n");
    writeFileSync(join(repo, "new-file.mjs"), "export {};\n");
    const id = dispatched(p, { backend: "tmux", worktree: repo });
    const res = collectTmux(id, { p, spawnImpl: spawnReturning({ status: 1 }) });

    assert.equal(res.outcome, "failed");
    const reason = read(id, p).parkedReason;
    assert.match(reason, /^worker exited without closing\n\nuncommitted in /);
    assert.match(reason, /README\.md/);
    assert.match(reason, /new-file\.mjs/);
    assert.match(lastComment(p, id), /new-file\.mjs/);
  });

  it("session gone + clean worktree = the reason stays as it was", () => {
    const p = store();
    const id = dispatched(p, { backend: "tmux", worktree: tempRepo() });
    collectTmux(id, { p, spawnImpl: spawnReturning({ status: 1 }) });
    assert.equal(read(id, p).parkedReason, "worker exited without closing");
  });

  it("a tmux that cannot run is a reason, not a throw", () => {
    const p = store();
    const id = dispatched(p, { backend: "tmux" });
    const res = collectTmux(id, { p, spawnImpl: spawnReturning({ error: new Error("spawn tmux ENOENT") }) });
    assert.equal(res.ok, false);
    assert.match(res.reason, /ENOENT/);
  });
});

describe("collectOrchestration — against the fake MCP server", () => {
  const caps = { backends: { orchestration: { available: true, path: FAKE_SERVER } } };

  function orchTask(p, { status = "done", claim = false } = {}) {
    return dispatched(p, { backend: "orchestration", run: "orchestration:run-fake-1", status, claim });
  }

  it("a terminal succeeded run records done, with the run's output as the summary", async () => {
    const p = store();
    const id = orchTask(p);
    const res = await collectOrchestration(id, {
      caps,
      p,
      env: { ...process.env, FAKE_STATE: "succeeded", FAKE_OUTPUT: "shipped: the gate is green\nnode --test passes" },
    });

    assert.equal(res.ok, true);
    assert.equal(res.outcome, "done");
    assert.match(lastComment(p, id), /shipped: the gate is green/, "the worker's own output, not a paraphrase");
    assert.deepEqual(results(p).map((e) => [e.run, e.outcome]), [["orchestration:run-fake-1", "done"]]);
  });

  it("a live run is pending — collection is a read, not a wait", async () => {
    const p = store();
    const id = orchTask(p, { status: "in_progress", claim: true });
    const res = await collectOrchestration(id, { caps, p, env: { ...process.env, FAKE_STATE: "running" } });

    assert.deepEqual(res, { ok: true, pending: true, state: "running" });
    assert.equal(read(id, p).status, "in_progress", "a pending collection changes nothing");
    assert.equal(results(p).length, 0);
  });

  it("a terminal failed run on an open task parks it", async () => {
    const p = store();
    const id = orchTask(p, { status: "in_progress", claim: true });
    const res = await collectOrchestration(id, { caps, p, env: { ...process.env, FAKE_STATE: "failed" } });

    assert.equal(res.ok, true);
    assert.equal(res.outcome, "failed");
    assert.equal(read(id, p).status, "parked");
    assert.match(read(id, p).parkedReason, /run ended failed/);
    assert.equal(claimed(p, id), false);
  });

  it("asks with the same consumer the dispatch spawned with, not the repo root", async () => {
    // Regression: dispatch/orchestration.mjs spawns with consumerCwd = the tm
    // worktree, whose repositoryKey (sha256(commonGitDir\0checkoutRoot)) differs
    // from the repo root's. Asking with p.root made every getRun answer
    // AO_RUN_REPOSITORY_MISMATCH, so no orchestration dispatch could ever be
    // collected. The task's own worktree field is what was passed on spawn.
    const p = store();
    const worktree = join(p.root, ".bytedesk", "worktrees", "TM-x-work");
    const id = dispatched(p, { backend: "orchestration", run: "orchestration:run-fake-1", worktree });
    const capture = join(p.root, "capture.json");

    const res = await collectOrchestration(id, { caps, p, env: { ...process.env, FAKE_STATE: "succeeded", FAKE_CAPTURE: capture } });
    assert.equal(res.ok, true);

    const params = JSON.parse(readFileSync(capture, "utf8"));
    assert.equal(params.arguments.consumerCwd, worktree, "the worktree, not the repo root");
    assert.notEqual(params.arguments.consumerCwd, p.root);
  });

  it("falls back to the repo root when the task carries no worktree", async () => {
    const p = store();
    const id = dispatched(p, { backend: "orchestration", run: "orchestration:run-fake-1" });
    const capture = join(p.root, "capture-noworktree.json");
    await collectOrchestration(id, { caps, p, env: { ...process.env, FAKE_STATE: "succeeded", FAKE_CAPTURE: capture } });
    assert.equal(JSON.parse(readFileSync(capture, "utf8")).arguments.consumerCwd, p.root);
  });

  it("an unavailable backend is a refusal, not a spawn", async () => {
    const p = store();
    const id = orchTask(p);
    const res = await collectOrchestration(id, { caps: { backends: { orchestration: { available: false, reason: "not found" } } }, p });
    assert.equal(res.ok, false);
    assert.match(res.reason, /not found/);
  });
});

describe("collectTopology — exact native workflow observation", () => {
  const caps = { backends: { topology: { available: true, path: "/fake/ao-topology" } } };
  function nativeTask(p, options = {}) {
    const id = dispatched(p, { backend: "topology", ...options });
    mutate(id, (task) => ({ dispatched: { ...task.dispatched, nativeRunId: id, recordPath: join(p.root, "durable", id, "run.json") } }), p);
    return id;
  }
  const response = (id, patch = {}) => spawnReturning({ status: 0, stdout: JSON.stringify({ run_id: id, state: "running", session_alive: true, observation_error: null, agents: [{ id: "worker", alive: true }], ...patch }) });

  it("asks the producer about the durable record, never a bare tmux name", () => {
    const p = store(), id = nativeTask(p), spawn = response(id);
    assert.deepEqual(collectTopology(id, { p, caps, spawnImpl: spawn }), { ok: true, pending: true, state: "running" });
    const [bin, args, opts] = spawn.calls[0];
    assert.equal(bin, "/fake/ao-topology");
    assert.deepEqual(args, ["status", "--run", join(p.root, "durable", id), "--consumer", p.root, "--json"]);
    assert.equal(opts.shell, false);
    assert.equal(results(p).length, 0);
  });

  it("collects only after exact observation proves native members ended", () => {
    const p = store(), done = nativeTask(p, { status: "done", claim: false });
    assert.equal(collectTopology(done, { p, caps, spawnImpl: response(done, { session_alive: false }) }).outcome, "done");
    const open = nativeTask(p);
    const res = collectTopology(open, { p, caps, spawnImpl: response(open, { agents: [{ id: "worker", alive: false }] }) });
    assert.equal(res.outcome, "failed");
    assert.equal(read(open, p).status, "parked");
    assert.equal(claimed(p, open), false);
  });

  it("holds unknown server/pane incarnations and mismatched native IDs without releasing ownership", () => {
    const p = store(), id = nativeTask(p);
    for (const patch of [
      { session_alive: null, observation_error: { code: "STALE_BINDING", message: "pane incarnation changed" } },
      { run_id: "different-run", session_alive: false },
      { session_alive: false, observation_error: undefined },
    ]) {
      const result = collectTopology(id, { p, caps, spawnImpl: response(id, patch) });
      assert.equal(result.ok, false); assert.equal(result.failureScope, "task");
      assert.equal(read(id, p).status, "in_progress"); assert.equal(claimed(p, id), true);
    }
  });

  it("holds legacy records until native import and rejects another backend handle", () => {
    const p = store(), legacy = dispatched(p, { backend: "topology" });
    const never = () => assert.fail("unbound records must not query a tmux session name");
    assert.match(collectTopology(legacy, { p, spawnImpl: never }).reason, /reconcile and import/);
    const other = dispatched(p, { backend: "topology", run: "tmux:tm-elsewhere" });
    assert.match(collectTopology(other, { p, spawnImpl: never }).reason, /has no topology run/);
  });

  function legacyFixture() {
    const p = paths(tempRepo()); stores.push(p.root); ensureDirs(p); seedGitContract(p);
    const worktree = addWorktree(p.root); stores.push(worktree);
    const id = dispatched(p, { backend: "topology", worktree });
    const runDir = join(worktree, ".bytedesk", "agent-orchestration", "runs", "native-old-1");
    mutate(id, (task) => ({ dispatched: { ...task.dispatched, runDir } }), p);
    const sourcePath = join(runDir, "run.json"), repoId = managementIdentity(id, p).repoId;
    const entry = { runtime: "topology", nativeRunId: "native-old-1", workflowId: "topology:native-old-1", repositoryId: repoId,
      taskId: id, workloadCwd: worktree, recordPath: join(p.root, "durable", "native-old-1", "run.json"), legacySourcePath: sourcePath };
    return { p, id, sourcePath, entry, index: { schemaVersion: 1, repository: { id: repoId }, workflows: [entry], rejected: [] } };
  }

  it("recovers an exact legacy producer reference and records its durable native handle", () => {
    const f = legacyFixture(), calls = [], original = read(f.id, f.p).dispatched.run;
    const env = { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: join(f.p.root, "isolated-state") };
    const spawn = (bin, args, opts) => {
      calls.push(args); assert.equal(bin, caps.backends.topology.path); assert.equal(opts.env, env);
      if (args[0] === "console") return { status: 0, stdout: JSON.stringify(f.index) };
      assert.deepEqual(args, ["status", "--run", dirname(f.entry.recordPath), "--consumer", f.p.root, "--json"]);
      return response(f.entry.nativeRunId)(bin, args, opts);
    };
    assert.equal(collectTopology(f.id, { p: f.p, caps, env, spawnImpl: spawn }).pending, true);
    assert.deepEqual(calls[0], ["console", "list", "--consumer", f.p.root, "--json"]);
    const recovered = read(f.id, f.p).dispatched;
    assert.equal(recovered.run, original);
    assert.equal(recovered.nativeRunId, f.entry.nativeRunId);
    assert.equal(recovered.workflowRunId, f.entry.workflowId);
    assert.equal(recovered.recordPath, f.entry.recordPath);
    assert.equal(recovered.legacyRecordPath, f.sourcePath);
    assert.equal(claimed(f.p, f.id), true);
    assert.equal(readEvents(f.p).filter((event) => event.event === "dispatch_reconciled").length, 1);
  });

  it("reconciles a live legacy path until the producer moves its terminal record", () => {
    const f = legacyFixture(), durablePath = f.entry.recordPath, calls = [];
    f.entry.recordPath = f.sourcePath;
    const spawn = (bin, args, opts) => {
      calls.push(args[0]);
      if (args[0] === "console") return { status: 0, stdout: JSON.stringify(f.index) };
      return response(f.entry.nativeRunId)(bin, args, opts);
    };
    assert.equal(collectTopology(f.id, { p: f.p, caps, spawnImpl: spawn }).pending, true);
    assert.equal(read(f.id, f.p).dispatched.recordPath, f.sourcePath);
    f.entry.recordPath = durablePath;
    assert.equal(collectTopology(f.id, { p: f.p, caps, spawnImpl: spawn }).pending, true);
    assert.equal(read(f.id, f.p).dispatched.recordPath, durablePath);
    assert.equal(collectTopology(f.id, { p: f.p, caps, spawnImpl: spawn }).pending, true);
    assert.deepEqual(calls, ["console", "status", "console", "status", "status"]);
  });

  // TM-417 (agent-fabric TM-016): a pool dispatch recorded the bare run id as its workflow id.
  function bareFixture() {
    const f = legacyFixture();
    delete f.entry.legacySourcePath;
    mutate(f.id, (task) => ({ dispatched: { ...task.dispatched, runDir: undefined, nativeRunId: "native-old-1", workflowRunId: "native-old-1", recordPath: f.entry.recordPath } }), f.p);
    const spawn = (index = f.index) => (bin, args, opts) => args[0] === "console" ? { status: 0, stdout: JSON.stringify(index) } : response(f.entry.nativeRunId)(bin, args, opts);
    return { ...f, spawn };
  }

  it("TM-417: tm rebind repairs a bare workflow id from the producer record, without collecting", () => {
    const f = bareFixture();
    const res = rebindTopology(f.id, { p: f.p, caps, env: {}, spawnImpl: f.spawn() });
    assert.deepEqual([res.rebound, res.from, res.to], [true, "native-old-1", "topology:native-old-1"]);
    assert.equal(read(f.id, f.p).dispatched.workflowRunId, "topology:native-old-1");
    assert.equal(read(f.id, f.p).status, "in_progress"); assert.equal(claimed(f.p, f.id), true);
    assert.equal(results(f.p).length, 0);
    assert.equal(rebindTopology(f.id, { p: f.p, caps, env: {}, spawnImpl: () => assert.fail("canonical needs no producer") }).rebound, false);
  });

  it("TM-417: collection repairs a bare workflow id before observing", () => {
    const f = bareFixture();
    assert.equal(collectTopology(f.id, { p: f.p, caps, spawnImpl: f.spawn() }).pending, true);
    assert.equal(read(f.id, f.p).dispatched.workflowRunId, "topology:native-old-1");
  });

  it("TM-417: rebind refuses a worker, a foreign workload checkout and a different native run", () => {
    const f = bareFixture();
    assert.throws(() => rebindTopology(f.id, { p: f.p, caps, env: { TM_DISPATCH_WORKER: "1" }, spawnImpl: f.spawn() }), /dispatched worker cannot rebind/);
    for (const change of [(index) => { index.workflows[0].workloadCwd = f.p.root; }, (index) => { index.workflows[0].nativeRunId = "other"; index.workflows[0].workflowId = "topology:other"; }]) {
      const index = structuredClone(f.index); change(index);
      assert.throws(() => rebindTopology(f.id, { p: f.p, caps, env: {}, spawnImpl: f.spawn(index) }), /does not match/);
      assert.equal(read(f.id, f.p).dispatched.workflowRunId, "native-old-1");
    }
  });

  it("holds missing, ambiguous, rejected and foreign legacy references without observing or releasing a worker", () => {
    const f = legacyFixture();
    for (const change of [
      (index) => { index.workflows = []; },
      (index) => { index.workflows.push({ ...index.workflows[0], nativeRunId: "other" }); },
      (index) => { index.repository.id = "/foreign/.git"; },
      (index) => { index.workflows[0].repositoryId = "/foreign/.git"; },
      (index) => { index.workflows[0].taskId = "TM-999"; },
      (index) => { index.workflows[0].workloadCwd = f.p.root; },
      (index) => { index.rejected.push({ path: f.sourcePath, code: "TOPOLOGY_INVALID_RUN_RECORD" }); },
    ]) {
      const index = structuredClone(f.index); change(index);
      const result = collectTopology(f.id, { p: f.p, caps, spawnImpl: (_bin, args) => {
        assert.equal(args[0], "console", "an unverified reference must not reach status or tmux");
        return { status: 0, stdout: JSON.stringify(index) };
      } });
      assert.equal(result.ok, false); assert.equal(result.failureScope, "task");
      assert.equal(read(f.id, f.p).dispatched.recordPath, undefined);
      assert.equal(read(f.id, f.p).status, "in_progress"); assert.equal(claimed(f.p, f.id), true);
    }
  });
});

describe("collect — the dispatched record is the routing table", () => {
  it("routes on task.dispatched.backend", async () => {
    const p = store();
    const id = dispatched(p, { backend: "tmux" });
    const res = await collect(id, p, { tmux: (tid) => ({ ok: true, routed: tid }) });
    assert.deepEqual(res, { ok: true, routed: id });
  });

  it("refuses a task that was never dispatched", async () => {
    const p = store();
    const t = create("task", { title: "manual work" }, "", p);
    const res = await collect(t.id, p);
    assert.equal(res.ok, false);
    assert.match(res.reason, /never dispatched/);
  });

  it("refuses a backend with no collector — manual work has no worker to hear from", async () => {
    const p = store();
    const id = dispatched(p, { backend: "manual" });
    const res = await collect(id, p);
    assert.equal(res.ok, false);
    assert.match(res.reason, /no collector for backend "manual"/);
  });

  it("never throws on garbage", async () => {
    const p = store();
    assert.equal((await collect(null, p)).ok, false);
    assert.equal((await collect("TM-404", p)).ok, false);
  });
});

describe("the handoff's completion contract", () => {
  it("tells a dispatched worker it has no later turn (TM-246)", () => {
    const p = store();
    const t = create("task", { title: "agent work", labels: ["ready-for-agent"] }, "", p);
    const out = handoff(t.id, p);
    assert.match(out, /Do the task in your own session/);
    assert.match(out, /Never end your turn while a background agent or command you started is still running/);
    assert.match(out, new RegExp(`Never ask a question and wait for an answer; nobody will reply\\. Block instead: \\S+tm block ${t.id} "<the question>"`));
    assert.match(out, /no run_in_background, no Monitor/, "TM-426: a headless worker must not background its checks");
  });

  it("carries the lead's latest LEAD BRIEF comment, not earlier rounds or other comments (TM-426)", () => {
    const p = store();
    const t = create("task", { title: "agent work", labels: ["ready-for-agent"] }, "", p);
    assert.doesNotMatch(handoff(t.id, p), /## Lead brief/, "no brief, no section");
    mutate(t.id, () => ({ comments: [
      { author: "main", ts: "2026-10-09T01:00:00Z", text: "LEAD BRIEF round 1: old ask" },
      { author: "main", ts: "2026-10-09T02:00:00Z", text: "LEAD BRIEF round 2: drop the logs" },
      { author: "worker:tmux", ts: "2026-10-09T03:00:00Z", text: "worker exited; mentions LEAD BRIEF mid-line" },
    ] }), p);
    const out = handoff(t.id, p);
    assert.match(out, /## Lead brief \(2026-10-09T02:00:00Z\)[^\n]*\nLEAD BRIEF round 2: drop the logs/);
    assert.doesNotMatch(out, /round 1|mid-line/);
    assert.ok(out.indexOf("## Lead brief") < out.indexOf("## When you finish"), "the brief precedes the finish steps");
  });

  it("tells a ready-for-agent worker exactly how to finish", () => {
    const p = store();
    const t = create(
      "task",
      { title: "agent work", labels: ["ready-for-agent"], acceptance: [{ text: "tests pass", done: false }] },
      "",
      p,
    );
    const out = handoff(t.id, p);

    assert.match(out, /## When you finish/);
    assert.match(out, new RegExp(`tm accept ${t.id} <n>`), "tick each criterion, once verified");
    assert.match(out, new RegExp(`tm evidence ${t.id} <path>`), "proof, not claims");
    assert.match(out, new RegExp(`tm done ${t.id}`));
    assert.match(out, new RegExp(`tm block ${t.id}`), "blocked is a first-class ending");
    assert.match(out, /Never leave the task in_progress/);
  });

  /**
   * TM-180. The worker's run ends at a PUSHED BRANCH AND A PR, never at a merge — the
   * guard (lib/worker-guard.mjs) blocks `gh pr merge` anyway, and a worker that reads
   * nothing else still reads this. The branch is stated literally when the task records
   * one, because "your branch" is not a command anybody can paste.
   */
  it("tells the worker to commit, push its own branch, and open a PR titled with the TM key", () => {
    const p = store();
    const t = create(
      "task",
      { title: "agent work", labels: ["ready-for-agent"], acceptance: [{ text: "tests pass", done: false }] },
      "",
      p,
    );
    mutate(t.id, () => ({ branch: `tm/${t.id}-agent-work` }), p);
    const out = handoff(t.id, p);

    assert.match(out, /Commit your work/i, "committing is step one");
    assert.match(out, new RegExp(`git push -u origin tm/${t.id}-agent-work`), "the literal branch, not a placeholder");
    assert.match(out, new RegExp(`gh pr create --title "${t.id}: agent work"`), "the TM key in the PR title");
    assert.match(out, /--body/, "the PR body says what changed and how it was verified");
    assert.match(out, /[Nn]ever merge/, "merging is a human's call");

    // Order matters: push and PR come before the close, or the close reports work nobody can see.
    const at = (re) => out.search(re);
    assert.ok(at(/Commit your work/i) < at(/git push -u origin/), "commit before push");
    assert.ok(at(/git push -u origin/) < at(/gh pr create/), "push before the PR");
    assert.ok(at(/gh pr create/) < at(new RegExp(`tm done ${t.id}`)), "the PR before the close");
  });

  it("says to block, not close, when the push or the PR fails", () => {
    const p = store();
    const t = create("task", { title: "agent work", labels: ["ready-for-agent"] }, "", p);
    const out = handoff(t.id, p);
    assert.match(out, /push or .*PR .*fail|fails?\b[^\n]*\b(push|PR)/i, "the failure case is named");
    assert.match(out, new RegExp(`tm block ${t.id} "`), "block with the error, instead of done");
  });

  it("names a generic tm/ branch when the task records none, rather than a broken command", () => {
    const p = store();
    const t = create("task", { title: "agent work", labels: ["ready-for-agent"] }, "", p);
    const out = handoff(t.id, p);
    assert.match(out, /git push -u origin <your tm\/ branch>/, "a placeholder that reads as one");
  });

  /**
   * TM-235. A worker's `gh pr create` with no `--base` targets the repository default, not
   * dispatch.integrationBranch — that shipped unreleased develop commits onto main in production.
   * The finish line must state the base literally, exactly as it already states the branch.
   */
  it("states the configured integration branch as the PR's --base", () => {
    const p = store();
    writeConfig({ dispatch: { integrationBranch: "develop" } }, p);
    const t = create("task", { title: "agent work", labels: ["ready-for-agent"] }, "", p);
    const out = handoff(t.id, p);
    assert.match(out, /gh pr create --title "[^"]+" --body "[^"]+" --base develop/, "the PR base, stated literally");
  });

  it("says nothing about it for a task a human is picking up", () => {
    const p = store();
    const t = create("task", { title: "human work", labels: ["needs-triage"] }, "", p);
    assert.equal(handoff(t.id, p).includes("## When you finish"), false);

    const unlabeled = create("task", { title: "plain work" }, "", p);
    assert.equal(handoff(unlabeled.id, p).includes("## When you finish"), false);
  });
});

/**
 * TM-180. A worker now finishes at a PR, so the board should carry the link — recorded
 * where every other ref already lives (the `commits` array `tm link <id> <ref>` writes and
 * the handoff renders as "Commits / PRs"), not in a field invented for it.
 *
 * `gh` is never really run here: the exec is injected. The rule the tests exist to hold is
 * that a missing `gh`, no PR, or a failing call records nothing and still collects cleanly —
 * a link is a nicety, and losing a worker's result over it would be the wrong trade.
 */
describe("the done path records the pull request (TM-180)", () => {
  const done = (p, branch) => {
    const id = dispatched(p, { status: "done", branch, acceptance: [{ text: "ok", done: true }] });
    return id;
  };

  it("records the PR url on the task when gh finds one", () => {
    const p = store();
    const id = done(p, "tm/TM-001-work");
    const exec = spawnReturning({ status: 0, stdout: "https://github.com/o/r/pull/7\n", stderr: "" });

    const res = recordResult(id, { outcome: "done", summary: "shipped" }, p, { exec });

    assert.equal(res.ok, true);
    assert.equal(res.outcome, "done");
    assert.deepEqual(read(id, p).commits, ["https://github.com/o/r/pull/7"]);
    const [bin, argv] = exec.calls[0];
    assert.equal(bin, "gh");
    assert.deepEqual(argv, ["pr", "list", "--head", "tm/TM-001-work", "--json", "url", "--jq", ".[0].url"]);
  });

  it("records it once, however many times the task is collected", () => {
    const p = store();
    const id = done(p, "tm/TM-001-work");
    const exec = spawnReturning({ status: 0, stdout: "https://github.com/o/r/pull/7\n", stderr: "" });
    recordResult(id, { outcome: "done", summary: "shipped" }, p, { exec });
    recordResult(id, { outcome: "done", summary: "shipped again" }, p, { exec });
    assert.deepEqual(read(id, p).commits, ["https://github.com/o/r/pull/7"]);
  });

  it("still collects when gh is not installed", () => {
    const p = store();
    const id = done(p, "tm/TM-001-work");
    const exec = spawnReturning({ error: new Error("spawn gh ENOENT") });

    const res = recordResult(id, { outcome: "done", summary: "shipped" }, p, { exec });

    assert.equal(res.ok, true, "a missing gh is not a failed collection");
    assert.equal(res.outcome, "done");
    assert.deepEqual(read(id, p).commits ?? [], []);
  });

  it("records nothing when there is no PR for the branch, or gh errors", () => {
    for (const answer of [{ status: 0, stdout: "\n" }, { status: 1, stdout: "", stderr: "no auth" }]) {
      const p = store();
      const id = done(p, "tm/TM-001-work");
      const res = recordResult(id, { outcome: "done", summary: "shipped" }, p, { exec: spawnReturning(answer) });
      assert.equal(res.ok, true);
      assert.deepEqual(read(id, p).commits ?? [], []);
    }
  });

  it("does not ask gh at all for a task with no branch, or an outcome that is not done", () => {
    const p = store();
    const noBranch = done(p, undefined);
    const execA = spawnReturning({ status: 0, stdout: "https://github.com/o/r/pull/7\n" });
    recordResult(noBranch, { outcome: "done", summary: "shipped" }, p, { exec: execA });
    assert.equal(execA.calls.length, 0, "no branch, nothing to look up");

    const failed = dispatched(p, { status: "in_progress", branch: "tm/TM-002-work" });
    const execB = spawnReturning({ status: 0, stdout: "https://github.com/o/r/pull/9\n" });
    recordResult(failed, { outcome: "failed", summary: "died" }, p, { exec: execB });
    assert.equal(execB.calls.length, 0, "a failure has no PR to record");
  });
});

describe("collect — one result per dispatch run (TM-238, TM-303)", () => {
  const workerComments = (p, id) => (read(id, p).comments || []).filter((c) => c.author.startsWith("worker:"));
  const dead = () => spawnReturning({ status: 1 });

  it("several pool ticks over a finished review-ready worker record one event and one comment", async () => {
    const p = store();
    const id = dispatched(p, { backend: "tmux" });
    mutate(id, () => ({ governance: { state: "ready-for-review" } }), p);
    const probe = dead();
    const impls = { tmux: (tid, { p: pp }) => collectTmux(tid, { p: pp, spawnImpl: probe }) };

    const ticks = [];
    for (let i = 0; i < 5; i++) ticks.push(await poolTick({ p, registry: {}, caps: {}, impls }));

    assert.equal(read(id, p).status, "in_progress", "review keeps the task open, which is why the pool comes back");
    assert.equal(ticks[0].collected[0].outcome, "ready-for-review");
    assert.deepEqual(ticks.slice(1).map((t) => t.collected[0].duplicate), [true, true, true, true]);
    assert.equal(results(p).length, 1, "exactly one task_result event");
    assert.equal(workerComments(p, id).length, 1, "exactly one worker comment");
    assert.equal(probe.calls.length, 5, "an in-progress task is still probed, so a changed outcome can be heard");
  });

  // A review-ready worker later blocked or parked; an ungoverned worker that closed through the gates.
  for (const [status, first] of [["blocked", "ready-for-review"], ["parked", "ready-for-review"], ["done", "done"]]) {
    it(`a ${status} task whose dispatch was already collected is skipped`, async () => {
      const p = store();
      const id = dispatched(p, { backend: "tmux", ...(status === "done" ? { status, claim: false } : {}) });
      if (status !== "done") mutate(id, () => ({ governance: { state: "ready-for-review" } }), p);
      assert.equal((await collect(id, p, { tmux: (tid, { p: pp }) => collectTmux(tid, { p: pp, spawnImpl: dead() }) })).outcome, first);
      if (status !== "done") mutate(id, () => ({ status }), p);

      const probe = dead();
      const res = await collect(id, p, { tmux: (tid, { p: pp }) => collectTmux(tid, { p: pp, spawnImpl: probe }) });
      assert.equal(res.ok, true);
      assert.equal(res.duplicate, true);
      assert.equal(probe.calls.length, 0);
      assert.equal(recordResult(id, { outcome: first, summary: "again" }, p).duplicate, true, "the write path refuses a repeat too");
      assert.equal(results(p).length, 1);
      assert.equal(workerComments(p, id).length, 1);
    });
  }

  it("a different outcome for the same run is recorded; a true repeat is not", () => {
    const p = store();
    const id = dispatched(p, { backend: "tmux" });
    mutate(id, () => ({ governance: { state: "ready-for-review" } }), p);
    assert.equal(recordResult(id, { outcome: "ready-for-review", summary: "submitted" }, p).duplicate, undefined);
    assert.equal(recordResult(id, { outcome: "ready-for-review", summary: "submitted" }, p).duplicate, true);
    const blocked = recordResult(id, { outcome: "blocked", summary: "push rejected" }, p);
    assert.equal(blocked.duplicate, undefined, "blocked after ready-for-review is news");
    assert.equal(blocked.outcome, "blocked");
    assert.equal(recordResult(id, { outcome: "blocked", summary: "push rejected" }, p).duplicate, true);
    assert.deepEqual(results(p).map((e) => e.outcome), ["ready-for-review", "blocked"]);
    assert.deepEqual(workerComments(p, id).map((c) => c.text), ["submitted", "push rejected"]);
    assert.equal(read(id, p).dispatched.collected.outcome, "blocked", "the stamp follows the latest outcome");
  });

  it("a dispatch with no run handle is keyed on dispatched.at and de-duplicated", () => {
    const p = store();
    const id = dispatched(p, { backend: "topology" });
    mutate(id, (doc) => ({ dispatched: { ...doc.dispatched, run: null } }), p);
    assert.equal(recordResult(id, { outcome: "failed", summary: "native worker ended" }, p).ok, true);
    assert.equal(recordResult(id, { outcome: "failed", summary: "native worker ended" }, p).duplicate, true);
    assert.equal(results(p).length, 1);
    assert.equal(workerComments(p, id).length, 1);
    assert.equal(read(id, p).dispatched.collected.dispatchedAt, read(id, p).dispatched.at);
  });

  it("a re-dispatch is a new run and is collected once more", async () => {
    const p = store();
    const id = dispatched(p, { backend: "tmux" });
    mutate(id, () => ({ governance: { state: "ready-for-review" } }), p);
    const impls = { tmux: (tid, { p: pp }) => collectTmux(tid, { p: pp, spawnImpl: dead() }) };
    await collect(id, p, impls);
    mutate(id, () => ({ dispatched: { backend: "tmux", run: `tmux:tm-${id}-r2`, session: SESSION, at: now() } }), p);
    await collect(id, p, impls);
    await collect(id, p, impls);
    assert.deepEqual(results(p).map((e) => e.run), [`tmux:tm-${id}`, `tmux:tm-${id}-r2`]);
  });
});

describe("recordResult — bounded retry with backoff before parking (TM-363)", () => {
  const retryEvents = (p) => readEvents(p).filter((e) => e.event === "dispatch_retry");
  const minutesAhead = (iso) => Math.round((Date.parse(iso) - Date.now()) / 60_000);
  /** Put the task back as a fresh dispatch of the same task, the way the pool re-dispatches it. */
  function redispatch(p, id, n) {
    mutate(id, (t) => ({ dispatched: { ...t.dispatched, run: `tmux:tm-${id}-r${n}`, at: now(), collected: undefined } }), p);
    update(id, { status: "in_progress" }, p);
  }

  it("a task-scoped failure reopens the task with 1- then 4-minute backoff, logs each retry, then parks", () => {
    const p = store({ retries: 2 });
    const id = dispatched(p);

    const first = recordResult(id, { outcome: "failed", summary: "worker exited without closing" }, p);
    assert.equal(first.parked, false);
    assert.deepEqual([first.retry.attempt, first.retry.retries], [1, 2]);
    assert.equal(read(id, p).status, "open", "reopened for the pool, not parked");
    assert.equal(read(id, p).dispatchRetries, 1);
    assert.equal(minutesAhead(read(id, p).retryAt), 1);
    assert.equal(claimed(p, id), false, "the claim is released so the pool can take it again");

    redispatch(p, id, 2);
    const second = recordResult(id, { outcome: "failed", summary: "worker exited without closing" }, p);
    assert.equal(second.retry.attempt, 2);
    assert.equal(minutesAhead(read(id, p).retryAt), 4);

    redispatch(p, id, 3);
    const third = recordResult(id, { outcome: "failed", summary: "worker exited without closing" }, p);
    assert.equal(third.retry, undefined, "retries exhausted");
    assert.equal(third.parked, true);
    assert.equal(read(id, p).status, "parked");

    const events = retryEvents(p);
    assert.deepEqual(events.map((e) => [e.id, e.attempt, e.retries]), [[id, 1, 2], [id, 2, 2]]);
    assert.equal(events[0].reason, "worker exited without closing");
    assert.ok(events[0].retryAt);
  });

  it("a system-scoped (provider) failure parks at once and is not retried", () => {
    const p = store({ retries: 2 });
    const id = dispatched(p);
    const res = recordResult(id, { outcome: "failed", summary: "You've hit your usage limit" }, p);
    assert.equal(res.failureScope, "provider");
    assert.equal(res.retry, undefined);
    assert.equal(res.parked, true);
    assert.equal(retryEvents(p).length, 0);
  });

  it("a worker that reports blocked is asking for a person: it parks, no retry", () => {
    const p = store({ retries: 2 });
    const id = dispatched(p);
    const res = recordResult(id, { outcome: "blocked", summary: "need a decision" }, p);
    assert.equal(res.parked, true);
    assert.equal(res.retry, undefined);
  });

  it("the default is 2 retries", () => {
    const p = tempStore();
    stores.push(p.root);
    const id = dispatched(p);
    assert.equal(recordResult(id, { outcome: "failed", summary: "x" }, p).retry.retries, 2);
  });
});
