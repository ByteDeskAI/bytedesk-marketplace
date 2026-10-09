// TM-247: a governed worker that dies can be retired and replaced. tm's half: one claim identity,
// a collector that leaves a lead-held task alone, a blocker recorded as a result, and a duplicate
// guard that knows a collected dispatch has no worker in flight.
import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { cleanup, git, tempRepo, tempStore } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { create, read, seedGitContract, state, update, writeConfig } from "../../lib/store.mjs";
import { provision } from "../../lib/worktree.mjs";
import { governTask } from "../../lib/governance.mjs";
import { managementIdentity } from "../../lib/governance-check.mjs";
import { claimTask, releaseClaim } from "../../lib/claims.mjs";
import { collectTmux, recordResult } from "../../lib/dispatch/collect.mjs";
import { dispatch } from "../../lib/dispatch/index.mjs";
import { liveOwner } from "../../lib/dispatch/live-owner.mjs";

const trash = [], beforeEnv = { ...process.env };
after(() => cleanup(...trash));
afterEach(() => {
  if (beforeEnv.AGENT_ORCHESTRATION_STATE_HOME === undefined) delete process.env.AGENT_ORCHESTRATION_STATE_HOME;
  else process.env.AGENT_ORCHESTRATION_STATE_HOME = beforeEnv.AGENT_ORCHESTRATION_STATE_HOME;
});
const save = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); };
const fake = { name: "fake", available: () => true, spawn: () => ({ ok: true, run: "tmux:tm-fake" }) };
const GONE = () => ({ status: 1 }); // tmux has-session: the worker's session no longer exists

/** caps naming a fake ao-topology that prints `status` for `lead status --cached`. */
function fakeAo(status) {
  const dir = mkdtempSync(join(tmpdir(), "tm460-ao-"));
  trash.push(dir);
  const bin = join(dir, "ao-topology");
  writeFileSync(bin, `#!/bin/sh\nprintf '%s' '${JSON.stringify(status)}'\n`, { mode: 0o755 });
  return { backends: { topology: { available: true, path: bin } } };
}

/** An admitted governed task whose admission owner is "lead-session" (the claim starts with it). */
function admitted() {
  const p = paths(tempRepo()), host = tempStore();
  trash.push(p.root, host.root);
  process.env.AGENT_ORCHESTRATION_STATE_HOME = host.root;
  ensureDirs(p); seedGitContract(p);
  writeConfig({ enforce: false, requireEpic: false, dispatch: { enabled: false, governed: true, backends: ["fake"] } }, p);
  const task = create("task", { title: "governed implementation", status: "in_progress", labels: ["ready-for-agent"], touches: ["result.txt"] }, "scope", p);
  const placed = provision(task, { session: "lead-session", p });
  const identity = managementIdentity(task.id, p);
  save(identity.recordPath, { task: task.id, repo_id: identity.repoId, started: true, owner: "lead-session", lead_id: "lead-1", workflow_run_id: "workflow-1",
    worktree: placed.path, branch: placed.branch, state: "working", base_revision: git(placed.path, "rev-parse", "HEAD") });
  governTask(task.id, { workflowRunId: "workflow-1", leadId: "lead-1", recordPath: identity.recordPath, p });
  return { p, id: task.id };
}

describe("TM-247 governed worker lifecycle (task-management)", () => {
  it("AC13: tm dispatch of an admitted task claims under the admission owner, not the dispatching session", async () => {
    const { p, id } = admitted();
    const res = await dispatch(id, { session: "transient-shell", p, backend: fake, caps: {} });
    assert.equal(res.ok, true, res.reason);
    assert.equal(state(p).claims[id].session, "lead-session");
    assert.equal(read(id, p).dispatched.session, "lead-session");
  });

  it("AC12: collecting a dead worker of a lead-held governed task records it and never parks or drops the claim", async () => {
    const { p, id } = admitted();
    assert.equal((await dispatch(id, { p, backend: fake, caps: {} })).ok, true);
    // TM-460: held only on ao's proof that the owner's lead is responsive.
    const res = collectTmux(id, { p, spawnImpl: GONE, caps: fakeAo({ status: "responsive", record: { agent_id: "lead-1" } }) });
    assert.equal(res.ok, true, res.reason);
    assert.equal(res.outcome, "failed");
    assert.equal(res.parked, false);
    assert.equal(res.heldByLead, true);
    assert.equal(read(id, p).status, "in_progress");
    assert.equal(state(p).claims[id]?.session, "lead-session", "the lead's claim survives the tick");
  });

  it("TM-460: a crashed worker whose owner is absent is parked or retried, though the dispatch claimed under the owner", async () => {
    const { p, id } = admitted();
    assert.equal((await dispatch(id, { p, backend: fake, caps: {} })).ok, true);
    assert.equal(state(p).claims[id].session, "lead-session", "the claim is the owner's, by AC13 alone");
    const res = collectTmux(id, { p, spawnImpl: GONE, caps: {} }); // no ao: nothing proves the lead alive
    assert.equal(res.ok, true, res.reason);
    assert.notEqual(res.heldByLead, true);
    assert.ok(res.parked || res.retry, "parked, or reopened for a retry");
    assert.notEqual(read(id, p).status, "in_progress");
  });

  for (const marker of [true, false]) {
    it(`TM-460: a re-claim under the lead's session after dispatch is not proof (worker marker ${marker ? "set" : "unset"})`, async () => {
      const { p, id } = admitted();
      assert.equal((await dispatch(id, { p, backend: fake, caps: {} })).ok, true);
      await new Promise((r) => setTimeout(r, 5));
      // The worker carries TM_SESSION_ID = the owner's; with `env -u TM_DISPATCH_WORKER`, or through
      // the dashboard API in the lead's process, its claim looks exactly like the lead's.
      if (marker) process.env.TM_DISPATCH_WORKER = "1";
      try {
        assert.equal(claimTask(id, { session: "lead-session", p }).ok, true);
      } finally {
        delete process.env.TM_DISPATCH_WORKER;
      }
      if (!marker) assert.ok(state(p).claims[id].since > read(id, p).dispatched.at, "the control: a fresh since after dispatch");
      const res = collectTmux(id, { p, spawnImpl: GONE, caps: {} });
      assert.notEqual(res.heldByLead, true);
      assert.ok(res.parked || res.retry, "a crashed worker is parked or retried");
    });
  }

  it("TM-460: a kept since keeps the worker flag of whoever took it", () => {
    const p = paths(tempRepo());
    trash.push(p.root);
    ensureDirs(p);
    // The lead takes the claim; the worker's re-claim keeps since, so the claim is still the lead's.
    claimTask("TM-901", { session: "lead-session", p });
    const leadSince = state(p).claims["TM-901"].since;
    process.env.TM_DISPATCH_WORKER = "1";
    try {
      claimTask("TM-901", { session: "lead-session", p });
      assert.equal(state(p).claims["TM-901"].since, leadSince);
      assert.equal(state(p).claims["TM-901"].worker, undefined, "since was taken by the lead, not a worker");
      // A worker takes a fresh claim; its re-claim keeps both since and the flag.
      claimTask("TM-902", { session: "lead-session", p });
      claimTask("TM-902", { session: "lead-session", p });
      assert.equal(state(p).claims["TM-902"].worker, true);
    } finally {
      delete process.env.TM_DISPATCH_WORKER;
    }
  });

  it("TM-460: the owner proven responsive by ao's cached lead status still holds the task", async () => {
    const { p, id } = admitted();
    assert.equal((await dispatch(id, { p, backend: fake, caps: {} })).ok, true);
    const caps = { backends: { topology: { available: true, path: "/fake/ao-topology" } } };
    const asked = [];
    const exec = (bin, args) => {
      asked.push([bin, ...args].join(" "));
      if (bin === "gh") return { status: 1 };
      return { status: 0, stdout: JSON.stringify({ status: "responsive", record: { agent_id: "lead-1" } }) };
    };
    // The caller's env must not widen "responsive" or lend its identity to the check.
    const envs = [];
    const spy = (bin, args, opts) => (envs.push(opts?.env), exec(bin, args, opts));
    Object.assign(process.env, { AO_RESPONSIVE_TTL_MS: "999999999", AO_AGENT_ID: "caller", TMUX_PANE: "%9" });
    let res;
    try {
      res = recordResult(id, { outcome: "failed", summary: "worker exited without closing" }, p, { exec: spy, caps });
    } finally {
      for (const k of ["AO_RESPONSIVE_TTL_MS", "AO_AGENT_ID", "TMUX_PANE"]) delete process.env[k];
    }
    const leadEnv = envs.find((e) => e && "PATH" in e);
    assert.ok(leadEnv, "the lead check runs with an explicit env");
    for (const k of ["AO_RESPONSIVE_TTL_MS", "AO_AGENT_ID", "TMUX_PANE"]) assert.equal(k in leadEnv, false, `${k} does not reach lead status`);
    assert.equal(res.heldByLead, true, asked.join("\n"));
    assert.ok(asked.includes("/fake/ao-topology lead status --cached"));
    assert.equal(read(id, p).status, "in_progress");
    // A different responsive lead is not this task's owner.
    const other = (bin) => (bin === "gh" ? { status: 1 } : { status: 0, stdout: JSON.stringify({ status: "responsive", record: { agent_id: "lead-2" } }) });
    const { p: p2, id: id2 } = admitted();
    assert.equal((await dispatch(id2, { p: p2, backend: fake, caps: {} })).ok, true);
    assert.notEqual(recordResult(id2, { outcome: "failed", summary: "x" }, p2, { exec: other, caps }).heldByLead, true);
  });

  it("AC12 control: a governed task whose claim is NOT the owner's is still parked or retried as before", async () => {
    const { p, id } = admitted();
    assert.equal((await dispatch(id, { p, backend: fake, caps: {} })).ok, true);
    releaseClaim(id, p);
    claimTask(id, { session: "someone-else", p });
    const res = recordResult(id, { outcome: "failed", summary: "worker exited without closing" }, p, { exec: () => ({ status: 1 }) });
    assert.ok(res.parked || res.retry, "parked, or reopened for a retry (TM-363)");
    assert.notEqual(read(id, p).status, "in_progress");
    assert.equal(state(p).claims[id], undefined, "the foreign claim is released as before");
  });

  it("a collected dispatch has no worker in flight: the guard frees it and a successor dispatch needs no --steal", async () => {
    const { p, id } = admitted();
    assert.equal((await dispatch(id, { p, backend: fake, caps: {} })).ok, true);
    assert.match(liveOwner(read(id, p), p, { caps: {} })?.reason || "", /already dispatched/);
    collectTmux(id, { p, spawnImpl: GONE });
    assert.equal(liveOwner(read(id, p), p, { caps: {} }), null);
    const successor = await dispatch(id, { p, backend: { ...fake, spawn: () => ({ ok: true, run: "tmux:tm-successor" }) }, caps: {} });
    assert.equal(successor.ok, true, successor.reason);
    assert.equal(read(id, p).dispatched.run, "tmux:tm-successor");
  });

  it("AC14: a worker that ran tm block and exited has its blocker collected as its result, once", async () => {
    const { p, id } = admitted();
    assert.equal((await dispatch(id, { p, backend: fake, caps: {} })).ok, true);
    update(id, { status: "blocked", blockedReason: "needs the staging credentials" }, p);
    releaseClaim(id, p);
    const res = collectTmux(id, { p, spawnImpl: GONE });
    assert.equal(res.outcome, "blocked", res.reason);
    assert.equal(read(id, p).dispatched.collected.outcome, "blocked");
    assert.ok(read(id, p).comments.some((c) => /needs the staging credentials/.test(c.text)));
    assert.equal(collectTmux(id, { p, spawnImpl: GONE }).duplicate, true);
    // The lead unblocks and re-claims: the collected dispatch no longer counts as a live worker.
    update(id, { status: "in_progress", blockedReason: undefined }, p);
    claimTask(id, { session: "lead-session", p });
    assert.equal(liveOwner(read(id, p), p, { caps: {} }), null);
  });
});
