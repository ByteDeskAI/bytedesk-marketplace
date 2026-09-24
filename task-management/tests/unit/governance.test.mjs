import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, git, tempRepo, tempStore } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { create, read, seedGitContract, state, update, write, writeConfig } from "../../lib/store.mjs";
import { provision, removeWorktree } from "../../lib/worktree.mjs";
import { governTask, readyForReview } from "../../lib/governance.mjs";
import { governedCompletion, managementIdentity, REVIEW_SEVERITIES } from "../../lib/governance-check.mjs";
import { gateDone } from "../../lib/enforce.mjs";
import { recordResult } from "../../lib/dispatch/collect.mjs";
import { dispatch } from "../../lib/dispatch/index.mjs";
import { poolTick } from "../../lib/dispatch/pool.mjs";
import { handoff, workerBrief } from "../../lib/render.mjs";
import { handleRequest } from "../../lib/mcp.mjs";
import { handleWrite } from "../../lib/dashboard-api.mjs";

const trash = [], beforeEnv = { ...process.env };
after(() => cleanup(...trash));
afterEach(() => {
  for (const key of ["AGENT_ORCHESTRATION_STATE_HOME", "TM_DISPATCH_WORKER", "TM_ENFORCE"]) {
    if (beforeEnv[key] === undefined) delete process.env[key]; else process.env[key] = beforeEnv[key];
  }
});
const save = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); };
function fixture() {
  const p = paths(tempRepo()), host = tempStore();
  trash.push(p.root, host.root);
  process.env.AGENT_ORCHESTRATION_STATE_HOME = host.root;
  delete process.env.TM_DISPATCH_WORKER;
  ensureDirs(p); seedGitContract(p);
  writeConfig({ enforce: false, dispatch: { enabled: false, governed: true, backends: ["fake"] } }, p);
  const task = create("task", { title: "governed implementation", status: "in_progress", labels: ["ready-for-agent"], touches: ["result.txt"], acceptance: [{ text: "verified", done: true }] }, "scope", p);
  const placed = provision(task, { session: "worker-1", p });
  const revision = git(placed.path, "rev-parse", "HEAD"), identity = managementIdentity(task.id, p);
  const record = { task: task.id, repo_id: identity.repoId, started: true, owner: "worker-1", lead_id: "lead-1", workflow_run_id: "workflow-1", worktree: placed.path, branch: placed.branch, state: "working", base_revision: revision };
  save(identity.recordPath, record);
  governTask(task.id, { workflowRunId: "workflow-1", leadId: "lead-1", recordPath: identity.recordPath, p });
  return { p, task, record, path: identity.recordPath, revision };
}
function submitted(f) {
  f.record.finish = { revision: f.revision, artifacts: ["result.txt"], checks: ["unit tests passed"], risks: [], evidence: "evidence/test-output.txt" };
  f.record.state = "ready-for-review";
  save(f.path, f.record);
  return readyForReview(f.task.id, { revision: f.revision, p: f.p });
}
function approved(f) {
  const { p, task, record, revision } = f;
  submitted(f);
  record.review = { task: task.id, repo_id: record.repo_id, revision, verified_commit: revision, verdict: "approve", findings: [], reviewer_id: "reviewer-1", author_agent_ids: ["worker-1"], request_nonce: "nonce-1", binding: { serverKey: "/tmp/server.sock", serverPid: 1, sessionId: "$1", sessionCreated: 10, paneId: "%1", panePid: 2 } };
  record.state = "merged"; record.collected = true;
  record.merge = { revision, landed: revision, target_branch: git(p.root, "symbolic-ref", "--short", "HEAD"), authorization: { decision: "integrate", actor: "human:ryan", authorized: true, revision } };
  save(f.path, record);
}

describe("governed completion is shared by every task write surface", () => {
  it("holds CLI, MCP, dashboard and direct writes despite AC ticks and disabled ordinary gates", async () => {
    const f = fixture();
    assert.equal(gateDone(f.task.id, f.p).allow, false);
    assert.throws(() => update(f.task.id, { status: "done" }, f.p), /submitted for review/);
    assert.throws(() => update(f.task.id, { governance: null, status: "done" }, f.p), /ownership cannot be cleared/);
    assert.throws(() => write({ ...read(f.task.id, f.p), status: "done" }, f.p), /submitted for review/);
    const stripped = { ...read(f.task.id, f.p), status: "done" }; delete stripped.governance;
    assert.throws(() => write(stripped, f.p), /ownership cannot be cleared/);
    const cli = spawnSync(process.execPath, [fileURLToPath(new URL("../../bin/tm", import.meta.url)), "done", f.task.id], { cwd: f.p.root, env: { ...process.env, TM_ROOT: f.p.root, TM_ENFORCE: "off" }, encoding: "utf8" });
    assert.notEqual(cli.status, 0); assert.match(cli.stderr, /submitted for review/);
    const mcp = await handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tm_task_update", arguments: { id: f.task.id, action: "done" } } }, { p: f.p });
    assert.match(JSON.stringify(mcp), /submitted for review/);
    const web = handleWrite("POST", `/api/task/${f.task.id}/transition`, { status: "done" }, { p: f.p });
    assert.equal(web.status, 409);
    assert.equal(read(f.task.id, f.p).status, "in_progress");
  });

  it("requires separate review and integration records and rejects stale or self review", () => {
    const f = fixture(); approved(f);
    assert.equal(governedCompletion(read(f.task.id, f.p), f.p).allow, true);
    for (const mutate of [
      (r) => { delete r.merge.authorization; },
      (r) => { r.review.reviewer_id = "worker-1"; },
      (r) => { delete r.review.binding.panePid; },
      (r) => { r.review.revision = "0".repeat(40); },
      (r) => { r.merge.target_branch = "absent-branch"; },
    ]) {
      const broken = structuredClone(f.record); mutate(broken); save(f.path, broken);
      assert.equal(governedCompletion(read(f.task.id, f.p), f.p).allow, false);
    }
    save(f.path, f.record);
    process.env.TM_DISPATCH_WORKER = "1";
    assert.equal(gateDone(f.task.id, f.p).allow, false, "worker cannot close even after integration");
  });

  it("accepts approval with only minor, nit or note findings and refuses blocking or malformed ones (TM-221)", () => {
    const f = fixture(); approved(f);
    const finding = (severity) => ({ severity, file: "result.txt", line: 1, claim: "c", evidence: "e", fix: "f" });
    const gate = (findings) => {
      const r = structuredClone(f.record); r.review.findings = findings; save(f.path, r);
      return governedCompletion(read(f.task.id, f.p), f.p).allow;
    };
    assert.equal(gate([]), true);
    assert.equal(gate([finding("minor"), finding("nit"), finding("note")]), true);
    for (const bad of [[finding("major")], [finding("blocker")], [finding("minor"), finding("major")],
      [finding("critical")], [{ file: "result.txt" }], ["minor"], [null], [[finding("minor")]]]) {
      assert.equal(gate(bad), false, JSON.stringify(bad));
    }
    assert.equal(gate(undefined), false);
    save(f.path, f.record);
  });

  it("review severities match agent-orchestration's reviewer (conformance)", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../agent-orchestration/topology/lib/reviewer.mjs"), "utf8");
    const list = (re) => JSON.parse(src.match(re)[1]);
    assert.deepEqual(REVIEW_SEVERITIES, list(/const SEVERITIES = (\[[^\]]*\]);/));
    assert.deepEqual(REVIEW_SEVERITIES.slice(0, 2), list(/const BLOCKING_SEVERITIES = new Set\((\[[^\]]*\])\);/));
  });

  it("retains exact review evidence after owned worktree cleanup", () => {
    const f = fixture(); approved(f);
    assert.equal(removeWorktree(read(f.task.id, f.p), { p: f.p }).removed, true);
    f.record.state = "cleaned"; save(f.path, f.record);
    assert.equal(gateDone(f.task.id, f.p).allow, true);
    update(f.task.id, { status: "done" }, f.p);
    assert.equal(read(f.task.id, f.p).status, "done");
  });

  it("worker reports stop at ready-for-review and preserve the claim on exit", () => {
    const f = fixture(); submitted(f);
    update(f.task.id, { dispatched: { backend: "fake", run: "fake:1" } }, f.p);
    const result = recordResult(f.task.id, { outcome: "done" }, f.p, { exec: () => ({ status: 1 }) });
    assert.equal(result.outcome, "ready-for-review"); assert.equal(result.parked, false);
    assert.equal(state(f.p).claims[f.task.id].session, "worker-1");
    assert.doesNotMatch(workerBrief(f.task.id, f.p), /Then close:/);
    assert.match(handoff(f.task.id, f.p), /ao-topology manage report .*--task TM-001 --file/);
  });

  it("cannot announce readiness before the producer accepts the exact finish protocol", () => {
    const f = fixture();
    assert.throws(() => readyForReview(f.task.id, { revision: f.revision, p: f.p }), /submit the producer finish report/);
    assert.equal(read(f.task.id, f.p).governance.state, "working");
    for (const render of [handoff, workerBrief]) {
      const brief = render(f.task.id, f.p);
      assert.match(brief, /ao-topology manage report .*--task TM-001 --file/);
      assert.match(brief, /"kind":"finish"/);
      assert.match(brief, /"artifacts":\[/);
      assert.match(brief, /"checks":\[/);
      assert.match(brief, /"risks":\[\]/);
      assert.match(brief, /"evidence":/);
      assert.match(brief, /queues independent review/);
    }
    submitted(f);
    f.record.finish.revision = "0".repeat(40); save(f.path, f.record);
    assert.throws(() => readyForReview(f.task.id, { revision: f.revision, p: f.p }), /accepted exact-revision finish/);
  });

  it("session-end preserves a submitted governed task and its ownership", () => {
    const f = fixture(); submitted(f);
    const cli = spawnSync(process.execPath, [fileURLToPath(new URL("../../bin/tm", import.meta.url)), "hook", "session-end"], {
      cwd: f.p.root, env: { ...process.env, TM_ROOT: f.p.root, CLAUDE_PROJECT_DIR: f.p.root },
      input: JSON.stringify({ cwd: f.p.root, session_id: "worker-1" }), encoding: "utf8",
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(read(f.task.id, f.p).status, "in_progress");
    assert.equal(read(f.task.id, f.p).governance.state, "ready-for-review");
    assert.equal(state(f.p).claims[f.task.id].session, "worker-1");
  });

  it("holds missing governed admission locally and automatically dispatches valid admitted tasks", async () => {
    const f = fixture();
    const other = create("task", { title: "not admitted", labels: ["ready-for-agent"] }, "scope", f.p);
    const backend = { name: "fake", available: () => true, spawn: () => ({ ok: true, run: "fake:1" }) };
    const held = await dispatch(other.id, { p: f.p, backend });
    assert.equal(held.code, "TM_GOVERNED_ADMISSION_REQUIRED"); assert.equal(held.failureScope, "task");
    writeConfig({ requireEpic: false, dispatch: { enabled: true } }, f.p);
    const tick = await poolTick({ p: f.p, registry: { fake: backend }, caps: {} });
    assert.equal(tick.dispatched[0]?.id, f.task.id);
    assert.equal(state(f.p).claims[f.task.id].session, "worker-1");
  });
});
