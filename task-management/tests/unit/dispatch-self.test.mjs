/**
 * TM-236 (gateway TM-455): a dispatched worker must recognise its own bound record.
 *
 * The worker for TM-455 read the `worker-bound` event on its task — its own tmux session, pane
 * and pid — as another session already working it, and exited. These tests drive the real `tm`
 * binary the way a worker does: as a descendant of the "harness" process, with the record naming
 * that ancestor's pid, its pane or its run — and, in the control, a different live pid.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, update } from "../../lib/store.mjs";
import { addComment } from "../../lib/issue.mjs";
import { registerAgent } from "../../lib/agents.mjs";
import { SELF_MARK, isSelf, markSelf, ownPids, selfIdentity } from "../../lib/dispatch/self.mjs";
import * as tmux from "../../lib/dispatch/tmux.mjs";
import { handoff, workerBrief } from "../../lib/render.mjs";

const TM = fileURLToPath(new URL("../../bin/tm", import.meta.url));
const trash = [];
after(() => cleanup(...trash));

/** A live process that is not this one and not an ancestor: the "different live pid" control. */
function sleeper() {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  after(() => child.kill());
  return child;
}

/** The worker-bound event ao-topology writes through `tm comment`, naming a pane process. */
const bound = (run, paneId, panePid) =>
  JSON.stringify({ event: "worker-bound", at: "2026-09-24T00:00:00.000Z", worker: { name: "agent:x", run, backend: "tmux", kind: "tmux", session_name: run.slice("tmux:".length), binding: { serverKey: "/tmp/s", serverPid: 1, sessionId: "$1", sessionCreated: 1, paneId, panePid } } });

/** `tm <args>` as a child of THIS process — this process is the worker's harness in the ancestry. */
function tm(p, args, env = {}) {
  const base = { ...process.env, TM_ROOT: p.root, TMUX_PANE: "", TM_DISPATCH_RUN: "" };
  for (const k of ["TM_DISPATCH_WORKER", "TM_DISPATCH_TASK", "TM_DISPATCH_BRANCH", "TM_DISPATCH_INTEGRATION_BRANCH"]) delete base[k];
  const res = spawnSync(process.execPath, [TM, ...args], { env: { ...base, ...env }, encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
}

function boundTask(p, { run = "tmux:tm-TM-001", paneId = "%9", panePid }) {
  const t = create("task", { title: "self test" }, "body", p);
  update(t.id, { dispatched: { backend: "tmux", run, session: "lead-session", at: "2026-09-24T00:00:00.000Z" } }, p);
  addComment(t.id, JSON.stringify({ event: "worker-started", at: "2026-09-24T00:00:00.000Z", backend: "tmux", run }), { author: "lead", p });
  addComment(t.id, bound(run, paneId, panePid), { author: "lead", p });
  return t.id;
}

describe("TM-236 — the worker's environment names it", () => {
  it("the tmux backend pins TM_DISPATCH_RUN to the run it will report", () => {
    const p = tempStore();
    trash.push(p.root);
    const spawned = [];
    const res = tmux.spawn(
      { task: { id: "TM-001", title: "x" }, worktree: p.root, branch: "tm/TM-001-x", integrationBranch: "main", prompt: "go", session: "s", actor: "a", p },
      { writeImpl: () => {}, spawnImpl: (_bin, args) => (spawned.push(args), { status: 0 }) },
    );
    assert.equal(res.run, "tmux:tm-TM-001");
    const at = spawned[0].indexOf("TM_DISPATCH_RUN=tmux:tm-TM-001");
    assert.ok(at > 0 && spawned[0][at - 1] === "-e", `pinned via tmux -e; argv was ${JSON.stringify(spawned[0])}`);
  });

  it("the handoff and the worker brief say who the reader is, literally", () => {
    const p = tempStore();
    trash.push(p.root);
    const t = create("task", { title: "self test", labels: ["ready-for-agent"] }, "body", p);
    const text = handoff(t.id, p);
    assert.match(text, new RegExp(`You are the bound worker for ${t.id}\\.`));
    assert.match(text, /worker-bound, worker-started, dispatched or agent-registry record .* is you — not another session/);
    assert.ok(text.indexOf("You are the dispatched worker") < text.indexOf("## When you finish"), "identity comes before the finish contract");
    assert.match(workerBrief(t.id, p), new RegExp(`You are the bound worker for ${t.id}: a worker-bound or dispatched record naming your own run, tmux session, pane or pid is you`));
  });
});

describe("TM-236 — isSelf: run, pane, own pid ancestry; never another live pid", () => {
  it("matches the caller's run, pane, own pid and an ancestor pid", () => {
    const self = selfIdentity({ TM_DISPATCH_RUN: "tmux:tm-TM-001", TMUX_PANE: "%9" });
    assert.ok(ownPids().has(process.pid) && ownPids().has(process.ppid), "own pid and parent are in the ancestry");
    assert.equal(isSelf({ run: "tmux:tm-TM-001" }, self), true, "the dispatched record, by run");
    assert.equal(isSelf({ runId: "tmux:tm-TM-001", pid: null }, self), true, "a registry row, by run");
    assert.equal(isSelf({ run: "tmux:tm-TM-002", binding: { paneId: "%9", panePid: 1 } }, self), true, "a bound worker, by pane");
    assert.equal(isSelf({ run: "process:1", pid: process.pid }, self), true, "a process worker, by own pid");
    assert.equal(isSelf({ binding: { paneId: "%1", panePid: process.ppid } }, self), true, "the pane process is an ancestor of the tm it runs");
    assert.equal(isSelf({ native_identity: { members: [{ id: "worker", pane: "%9", binding: null }] } }, self), true, "a topology worker, by member pane");
  });

  it("a different live pid is another worker, and no env at all only matches by ancestry", () => {
    const other = sleeper();
    const self = selfIdentity({ TM_DISPATCH_RUN: "tmux:tm-TM-001", TMUX_PANE: "%9" });
    assert.equal(isSelf({ run: "tmux:tm-TM-002", binding: { paneId: "%4", panePid: other.pid } }, self), false, "live, but not us");
    assert.equal(isSelf({ run: "process:x", pid: other.pid }, self), false);
    const bare = selfIdentity({});
    assert.equal(isSelf({ run: "tmux:tm-TM-001", binding: { paneId: "%9", panePid: other.pid } }, bare), false, "no run/pane in env: run and pane cannot match");
    assert.equal(isSelf({ pid: process.pid }, bare), true, "ancestry needs no env");
    assert.equal(isSelf(null, self), false);
    assert.equal(isSelf({ run: "", pid: "1" }, self), false, "a string pid is not a pid");
  });

  it("markSelf annotates the dispatched record and the ao-topology events, and nothing else", () => {
    const other = sleeper();
    const self = selfIdentity({ TM_DISPATCH_RUN: "tmux:tm-TM-001" });
    assert.equal(ownPids().has(1), false, "init is nobody's worker");
    const doc = { id: "TM-001", dispatched: { backend: "tmux", run: "tmux:tm-TM-001" }, comments: [
      { author: "lead", text: JSON.stringify({ event: "worker-started", backend: "tmux", run: "tmux:tm-TM-001" }) },
      { author: "lead", text: bound("tmux:tm-TM-001", "%9", other.pid) },
      { author: "lead", text: bound("tmux:tm-TM-002", "%4", other.pid) },
      { author: "human", text: "plain prose naming tmux:tm-TM-001 is not an event" },
    ] };
    const marked = markSelf(doc, self);
    assert.equal(marked.dispatched.self, true);
    assert.deepEqual(marked.comments.map((c) => c.self ?? false), [true, true, false, false]);
    assert.equal(doc.dispatched.self, undefined, "pure: the input is untouched");
  });
});

describe("TM-236 — tm show and tm agent list, run as the worker's descendant", () => {
  it("a worker-bound record naming the harness pid (our ancestor) is self, in --json and in text", () => {
    const p = tempStore();
    trash.push(p.root);
    const id = boundTask(p, { panePid: process.pid });
    const doc = JSON.parse(tm(p, ["show", id, "--json"]));
    assert.equal(doc.dispatched.self, undefined, "the dispatched record matches by run only, and no run is in the env");
    assert.deepEqual(doc.comments.map((c) => c.self ?? false), [false, true], "the worker-bound event names our ancestor's pid");
    const text = tm(p, ["show", id]);
    assert.match(text, /^dispatched: tmux run=tmux:tm-TM-001 session=lead-session$/m, "the dispatch record is in the text view now");
    const lines = text.split("\n").filter((l) => l.includes(SELF_MARK));
    assert.equal(lines.length, 1, `exactly the bound record is marked:\n${text}`);
    assert.match(lines[0], /worker-bound/);
  });

  it("the same record naming a different live pid is reported as a second worker", () => {
    const p = tempStore();
    trash.push(p.root);
    const other = sleeper();
    const id = boundTask(p, { panePid: other.pid });
    const doc = JSON.parse(tm(p, ["show", id, "--json"]));
    assert.deepEqual(doc.comments.map((c) => c.self ?? false), [false, false]);
    assert.equal(tm(p, ["show", id]).includes(SELF_MARK), false, "nothing is marked self");
  });

  it("the caller's own pane or run marks the record even when the pid is another's", () => {
    const p = tempStore();
    trash.push(p.root);
    const other = sleeper();
    const id = boundTask(p, { paneId: "%9", panePid: other.pid });
    const byPane = JSON.parse(tm(p, ["show", id, "--json"], { TMUX_PANE: "%9" }));
    assert.deepEqual(byPane.comments.map((c) => c.self ?? false), [false, true], "TMUX_PANE names the bound pane");
    const byRun = JSON.parse(tm(p, ["show", id, "--json"], { TM_DISPATCH_RUN: "tmux:tm-TM-001" }));
    assert.equal(byRun.dispatched.self, true, "TM_DISPATCH_RUN names the dispatched run");
    assert.deepEqual(byRun.comments.map((c) => c.self ?? false), [true, true], "and both events carry that run");
  });

  it("works with agent-orchestration absent: no ao-topology on PATH, and the bound record is still self", () => {
    const p = tempStore();
    trash.push(p.root);
    const PATH = [dirname(process.execPath), "/usr/bin", "/bin"].join(":");
    const probe = spawnSync("sh", ["-c", "command -v ao-topology"], { env: { PATH }, encoding: "utf8" });
    assert.notEqual(probe.status, 0, `ao-topology must be absent for this test to mean anything: ${probe.stdout}`);
    const id = boundTask(p, { panePid: process.pid });
    const doc = JSON.parse(tm(p, ["show", id, "--json"], { PATH, TM_DISPATCH_RUN: "tmux:tm-TM-001" }));
    assert.equal(doc.dispatched.self, true);
    assert.deepEqual(doc.comments.map((c) => c.self ?? false), [true, true]);
  });

  it("tm agent list marks the registry row that is the caller", () => {
    const p = tempStore();
    trash.push(p.root);
    const other = sleeper();
    registerAgent({ name: "agent:TM-001-lead", backend: "tmux", runId: "tmux:tm-TM-001", pid: process.pid, session: "lead" }, p);
    registerAgent({ name: "agent:TM-002-lead", backend: "tmux", runId: "tmux:tm-TM-002", pid: other.pid, session: "lead" }, p);
    const rows = JSON.parse(tm(p, ["agent", "list", "--json"]));
    assert.deepEqual(Object.fromEntries(rows.map((r) => [r.name, r.self ?? false])), { "agent:TM-001-lead": true, "agent:TM-002-lead": false });
    const text = tm(p, ["agent", "list"]);
    assert.match(text, /agent:TM-001-lead .*\(self — this is you\)/);
    assert.doesNotMatch(text, /agent:TM-002-lead .*self/);
  });
});
