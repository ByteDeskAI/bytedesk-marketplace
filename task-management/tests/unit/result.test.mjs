/**
 * The result protocol: how a dispatched worker's completion becomes store truth.
 *
 * recordResult is the single write path — the AC gate stays the real gate (a
 * "done" report for a task that is not done downgrades to failed), failure parks
 * and releases the claim, and everything lands as a comment plus one task_result
 * event. The collectors normalize each backend's completion signal into it:
 * tmux against a stubbed spawnImpl, orchestration against the fake MCP server
 * (fixtures/fake-orchestration-mcp.mjs), fleet against a stubbed events output.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempStore } from "./helpers.mjs";
import { handoff } from "../../lib/render.mjs";
import { create, mutate, now, read, readEvents, state, update, writeState } from "../../lib/store.mjs";
import { collect, collectFleet, collectOrchestration, collectTmux, recordResult } from "../../lib/dispatch/collect.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_SERVER = join(HERE, "fixtures", "fake-orchestration-mcp.mjs");

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const SESSION = "lead-session";

/** The run handle each backend really records on the task. */
const RUN_SHAPES = {
  tmux: (id) => `tmux:tm-${id}`,
  fleet: (id) => `fleet:${id}`,
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

  it("an unavailable backend is a refusal, not a spawn", async () => {
    const p = store();
    const id = orchTask(p);
    const res = await collectOrchestration(id, { caps: { backends: { orchestration: { available: false, reason: "not found" } } }, p });
    assert.equal(res.ok, false);
    assert.match(res.reason, /not found/);
  });
});

describe("collectFleet — the event tail carries the ending", () => {
  const eventsOut = (lines) => spawnReturning({ status: 0, stdout: lines.map((l) => JSON.stringify(l)).join("\n") + (lines.length ? "\n" : ""), stderr: "" });
  const progress = { ts: "2026-09-02T10:00:00Z", ticket: "TM-001", depth: 0, kind: "commit_pushed", detail: { branch: "feat/x" } };
  const merge = { ts: "2026-09-02T10:05:00Z", ticket: "TM-001", depth: 0, kind: "merge", detail: { pr: "346" } };
  const error = { ts: "2026-09-02T10:06:00Z", ticket: "TM-001", depth: 0, kind: "error", detail: { message: "pane died" } };

  it("a merge event with the task closed records done", () => {
    const p = store();
    const id = dispatched(p, { backend: "fleet", status: "done", claim: false });
    const spawn = eventsOut([progress, merge]);

    const res = collectFleet(id, { p, bin: "/plugins/fleet/bin/claude-sessions", spawnImpl: spawn });
    assert.equal(res.ok, true);
    assert.equal(res.outcome, "done");
    assert.match(lastComment(p, id), /merge/);

    const [bin, args, opts] = spawn.calls[0];
    assert.equal(bin, "/plugins/fleet/bin/claude-sessions");
    assert.deepEqual(args, ["events", id, "--json"], "the ticket is the run handle, argv-only");
    assert.equal(opts.shell, false);
  });

  it("no terminal event is pending; an empty tail is pending too", () => {
    const p = store();
    const id = dispatched(p, { backend: "fleet" });
    assert.deepEqual(collectFleet(id, { p, bin: "/x/claude-sessions", spawnImpl: eventsOut([progress]) }), { ok: true, pending: true });
    assert.deepEqual(collectFleet(id, { p, bin: "/x/claude-sessions", spawnImpl: eventsOut([]) }), { ok: true, pending: true });
    assert.equal(results(p).length, 0);
  });

  it("an error event on an open task is failed, and the last terminal event wins", () => {
    const p = store();
    const id = dispatched(p, { backend: "fleet" });
    const res = collectFleet(id, { p, bin: "/x/claude-sessions", spawnImpl: eventsOut([merge, error]) });
    assert.equal(res.ok, true);
    assert.equal(res.outcome, "failed", "the merge came before the error; the error is the ending");
    assert.equal(read(id, p).status, "parked");
  });

  it("a failing claude-sessions is a reason, not a throw", () => {
    const p = store();
    const id = dispatched(p, { backend: "fleet" });
    const res = collectFleet(id, { p, bin: "/x/claude-sessions", spawnImpl: spawnReturning({ status: 64, stderr: "events: missing <ticket>" }) });
    assert.equal(res.ok, false);
    assert.match(res.reason, /exited 64/);
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

  it("says nothing about it for a task a human is picking up", () => {
    const p = store();
    const t = create("task", { title: "human work", labels: ["needs-triage"] }, "", p);
    assert.equal(handoff(t.id, p).includes("## When you finish"), false);

    const unlabeled = create("task", { title: "plain work" }, "", p);
    assert.equal(handoff(unlabeled.id, p).includes("## When you finish"), false);
  });
});
