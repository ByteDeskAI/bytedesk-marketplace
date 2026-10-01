import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tempStore } from "./helpers.mjs";
import { create, read, update, write, setCriterion, removeCriterion, autoCloseEpic } from "../../lib/store.mjs";
import { goalOpen, goalShow, goalFinding, goalAssess, goalRevise, goalComplete } from "../../lib/goal-feedback.mjs";

const ARTIFACT = "a".repeat(40);
function fixture(overrides = {}) {
  const p = tempStore();
  const epic = create("epic", { title: "Original user outcome", status: "open" }, "Original requirement", p);
  const input = { objective: "Users can finish the original journey", criteria: [{ text: "The deployed journey succeeds" }], authority: { reviewedMerge: true, testTarget: "test.local", publicRelease: "human", destructive: "human" }, ...overrides };
  const { goal } = goalOpen(epic.id, input, p);
  return { p, id: epic.id, goal, input };
}
function proof(f, changes = {}) {
  const evidence = join(f.p.root, "browser-result.txt");
  writeFileSync(evidence, "Observed user completes original journey in deployed test application");
  const evaluator = { id: "validator", role: "dogfood", independentOf: ["implementer"] };
  const data = { revision: f.goal.revision, scopeHash: f.goal.scopeHash, artifact: ARTIFACT, environment: "test.local", persona: "project owner", evaluator, implementerId: "implementer", criteria: [{ id: "AC-001", verdict: "proven", evidence: [evidence] }], ...changes };
  const deployment = join(f.p.root, "deployment.json");
  writeFileSync(deployment, JSON.stringify({ schemaVersion: 1, kind: "deployment", goalId: f.id, artifact: data.artifact, environment: data.environment, deployedAt: new Date(Date.now() - 1000).toISOString(), actor: "deployer", source: "test deployment observation" }));
  const source = join(f.p.root, "dogfood.json");
  writeFileSync(source, JSON.stringify({ schemaVersion: 1, kind: "dogfood", goalId: f.id, ...data, recordedAt: new Date().toISOString(), criteria: data.criteria.map(c => ({ ...c, observed: "User completed the deployed journey", expected: "Journey completes" })) }));
  return { ...data, source, deployment };
}
describe("goal feedback scope and proof", () => {
  it("persists immutable original scope and stable criteria across reloads", () => {
    const f = fixture();
    assert.equal(goalShow(f.id, f.p).goal.original.criteria[0].id, "AC-001");
    assert.equal(goalShow(f.id, f.p).goal.scopeHash, f.goal.scopeHash);
    assert.throws(() => update(f.id, { goal: null }, f.p), /goal/);
    assert.throws(() => write({ ...read(f.id, f.p), goal: undefined }, f.p), /goal/);
    assert.throws(() => removeCriterion(f.id, 1, f.p), /goal|scope/);
    setCriterion(f.id, 1, true, f.p);
    assert.throws(() => goalComplete(f.id, { revision: 1, scopeHash: f.goal.scopeHash, artifact: ARTIFACT, environment: "test.local" }, f.p), /assessment|proof/);
    assert.throws(() => update(f.id, { status: "done" }, f.p), /goal/);
    assert.throws(() => update(f.id, { status: "deleted" }, f.p), /goal/);
    create("task", { title: "child", status: "done", epic: f.id }, "", f.p);
    assert.equal(autoCloseEpic(f.id, f.p), false);
  });
  it("completes only with current independent deployed evidence and survives reload", () => {
    const f = fixture(), input = proof(f);
    const assessed = goalAssess(f.id, input, f.p);
    assert.equal(assessed.goal.assessments.length, 1);
    assert.equal(read(f.id, f.p).evidence.length, 3, "receipts remain visible through the existing evidence surface");
    assert.ok(read(f.id, f.p).evidenceSources[read(f.id, f.p).evidence[0]].sha256);
    const done = goalComplete(f.id, { revision: 1, scopeHash: f.goal.scopeHash, artifact: ARTIFACT, environment: "test.local" }, f.p);
    assert.equal(done.goal.status, "proven");
    assert.equal(read(f.id, f.p).status, "done");
    assert.equal(goalShow(f.id, f.p).goal.completion.artifact, ARTIFACT);
  });
  it("refuses self validation, boolean proof, stale scope, stale deployment and missing files", () => {
    const f = fixture();
    assert.throws(() => goalAssess(f.id, { revision: 1, proven: true }, f.p), /scope|artifact|receipt/);
    assert.throws(() => goalAssess(f.id, proof(f, { evaluator: { id: "implementer", role: "dogfood", independentOf: ["implementer"] } }), f.p), /independent/);
    assert.throws(() => goalAssess(f.id, proof(f, { revision: 2 }), f.p), /scope|revision/);
    const input = proof(f);
    const receipt = JSON.parse(readFileSync(input.deployment, "utf8"));
    writeFileSync(input.deployment, JSON.stringify({ ...receipt, artifact: "b".repeat(40) }));
    assert.throws(() => goalAssess(f.id, input, f.p), /deployment|artifact/);
  });
  it("refuses changed evidence or a different artifact after assessment", () => {
    const f = fixture(), input = proof(f);
    goalAssess(f.id, input, f.p);
    const completion = { revision: 1, scopeHash: f.goal.scopeHash, artifact: ARTIFACT, environment: "test.local" };
    assert.throws(() => goalComplete(f.id, { ...completion, artifact: "b".repeat(40) }, f.p), /artifact/);
    writeFileSync(input.criteria[0].evidence[0], "Changed result");
    assert.throws(() => goalComplete(f.id, completion, f.p), /evidence|changed|stale/);
  });
  it("cannot omit unfinished or deleted child tasks from the completion scope", () => {
    const f = fixture(), input = proof(f);
    const task = create("task", { title: "In-scope implementation", status: "open", epic: f.id }, "implementation", f.p);
    goalAssess(f.id, input, f.p);
    const completion = { revision: 1, scopeHash: f.goal.scopeHash, artifact: ARTIFACT, environment: "test.local" };
    assert.throws(() => goalComplete(f.id, completion, f.p), /in-scope child/);
    assert.throws(() => update(task.id, { epic: null }, f.p), /admitted goal scope/);
    update(task.id, { status: "deleted" }, f.p);
    assert.throws(() => goalComplete(f.id, completion, f.p), /in-scope child/);
    update(task.id, { status: "done" }, f.p);
    assert.equal(goalComplete(f.id, completion, f.p).goal.status, "proven");
  });
  it("keeps blocking findings until a fresh assessment resolves them with completed corrective tasks", () => {
    const f = fixture();
    const task = create("task", { title: "Fix observed issue", status: "open", epic: f.id }, "fix", f.p);
    const finding = goalFinding(f.id, { category: "workflow", criterionIds: ["AC-001"], observed: "Validation omitted the user journey", expected: "Run the journey", reproduction: "Inspect first iteration", source: "dogfood", artifact: ARTIFACT, environment: "test.local", persona: "project owner", evidence: [], correctiveTaskIds: [task.id] }, f.p).goal.findings[0];
    const input = proof(f);
    goalAssess(f.id, input, f.p);
    const completion = { revision: 1, scopeHash: f.goal.scopeHash, artifact: ARTIFACT, environment: "test.local" };
    assert.throws(() => goalComplete(f.id, completion, f.p), /finding/);
    assert.throws(() => goalAssess(f.id, { ...input, resolvesFindingIds: [finding.id] }, f.p), /corrective|task/);
    update(task.id, { status: "done" }, f.p);
    goalAssess(f.id, { ...proof(f), resolvesFindingIds: [finding.id] }, f.p);
    assert.equal(goalComplete(f.id, completion, f.p).goal.status, "proven");
  });
  it("requires a scope-change receipt, preserves originals, and invalidates old proof", () => {
    const f = fixture();
    goalAssess(f.id, proof(f), f.p);
    assert.throws(() => goalRevise(f.id, { revision: 1, criteria: [] }, f.p), /scope|approval|criteria/);
    const criteria = [...f.goal.criteria, { text: "Workflow feedback is recorded" }];
    const approval = join(f.p.root, "scope-approval.json");
    writeFileSync(approval, JSON.stringify({ schemaVersion: 1, kind: "scope-change", goalId: f.id, revision: 1, scopeHash: f.goal.scopeHash, reason: "User adds feedback requirement", objective: f.goal.original.objective, criteria, authorizedBy: "human:owner", recordedAt: new Date().toISOString() }));
    const revised = goalRevise(f.id, { revision: 1, scopeHash: f.goal.scopeHash, reason: "User adds feedback requirement", criteria, approval }, f.p).goal;
    assert.equal(revised.original.scopeHash, f.goal.scopeHash);
    assert.equal(revised.criteria[0].id, "AC-001");
    assert.equal(revised.criteria[1].id, "AC-002");
    assert.equal(revised.revisions.length, 2);
    assert.throws(() => goalComplete(f.id, { revision: 2, scopeHash: revised.scopeHash, artifact: ARTIFACT, environment: "test.local" }, f.p), /assessment|scope|proof/);
  });
  it("deduplicates replayed writes and refuses changed use of an idempotency key", () => {
    const f = fixture(), input = { ...proof(f), idempotencyKey: "iteration-1" };
    goalAssess(f.id, input, f.p);
    goalAssess(f.id, input, f.p);
    assert.equal(goalShow(f.id, f.p).goal.assessments.length, 1);
    assert.throws(() => goalAssess(f.id, { ...input, persona: "another" }, f.p), /idempotency/);
  });
  it("detects missing/corrupted captured evidence and does not trust a completion replay", () => {
    const f = fixture(), input = proof(f);
    const assessed = goalAssess(f.id, input, f.p);
    const completion = { revision: 1, scopeHash: f.goal.scopeHash, artifact: ARTIFACT, environment: "test.local", idempotencyKey: "complete-1" };
    goalComplete(f.id, completion, f.p);
    const copy = join(f.p.root, assessed.goal.assessments[0].evidence[0].copy);
    writeFileSync(copy, "corrupted");
    assert.equal(goalShow(f.id, f.p).verification.completionReady, false);
    assert.throws(() => goalComplete(f.id, completion, f.p), /evidence|changed/);
    const missing = fixture(), missingProof = proof(missing);
    goalAssess(missing.id, missingProof, missing.p);
    unlinkSync(missingProof.criteria[0].evidence[0]);
    assert.throws(() => goalComplete(missing.id, { ...completion, scopeHash: missing.goal.scopeHash }, missing.p), /evidence file is missing/);
  });
  it("bounds no-progress and cycles durably without treating new artifacts as progress", () => {
    const f = fixture();
    for (let n = 0; n < 3; n++) {
      const input = proof(f, { artifact: String(n + 1).repeat(40), criteria: [{ id: "AC-001", verdict: "failed", evidence: [] }] });
      goalAssess(f.id, input, f.p);
    }
    const stopped = goalShow(f.id, f.p).goal;
    assert.equal(stopped.status, "human_required");
    assert.equal(stopped.escalation.reason, "no_progress");
    assert.equal(stopped.stalls, 3);
    assert.throws(() => goalAssess(f.id, proof(f), f.p), /human_required/);
    const bounded = fixture({ limits: { maxCycles: 1 } });
    goalAssess(bounded.id, proof(bounded, { criteria: [{ id: "AC-001", verdict: "unproven", evidence: [] }] }), bounded.p);
    assert.equal(goalShow(bounded.id, bounded.p).goal.status, "active", "initial assessment is not a repair cycle");
    goalAssess(bounded.id, proof(bounded, { criteria: [{ id: "AC-001", verdict: "unproven", evidence: [] }] }), bounded.p);
    assert.equal(goalShow(bounded.id, bounded.p).goal.cycles, 2);
    assert.equal(goalShow(bounded.id, bounded.p).goal.repairCycles, 1);
    assert.equal(goalShow(bounded.id, bounded.p).goal.escalation.reason, "cycle_limit");
  });
  it("does not reset no-progress by alternating which criterion passes", () => {
    const f = fixture({ criteria: [{ text: "First original outcome" }, { text: "Second original outcome" }] });
    for (let n = 0; n < 4; n++) {
      const criteria = f.goal.criteria.map((c, index) => ({ id: c.id, verdict: index === n % 2 ? "proven" : "failed", evidence: index === n % 2 ? [join(f.p.root, "browser-result.txt")] : [] }));
      goalAssess(f.id, proof(f, { criteria }), f.p);
    }
    const goal = goalShow(f.id, f.p).goal;
    assert.equal(goal.bestProven, 1);
    assert.equal(goal.stalls, 3);
    assert.equal(goal.status, "human_required");
  });
  it("leaves persisted per-phase deadlines to orchestration, not whole-goal admission time", () => {
    const f = fixture(), input = proof(f), originalNow = Date.now;
    try {
      Date.now = () => Date.parse(f.goal.openedAt) + 8 * 30 * 60000;
      assert.equal(goalShow(f.id, f.p).goal.deadlineAt, undefined);
      assert.equal(goalShow(f.id, f.p).goal.limits.phaseDeadlineMinutes, 30);
      assert.equal(read(f.id, f.p).goal.status, "active");
      assert.equal(goalAssess(f.id, input, f.p).goal.status, "active");
      assert.equal(goalComplete(f.id, { revision: 1, scopeHash: f.goal.scopeHash, artifact: ARTIFACT, environment: "test.local" }, f.p).goal.status, "proven");
    } finally { Date.now = originalNow; }
  });
  it("rejects evidence escaping the repo through a symlink", () => {
    const f = fixture(), other = fixture(), input = proof(f);
    const foreign = join(other.p.root, "foreign.txt");
    writeFileSync(foreign, "foreign evidence");
    const alias = join(f.p.root, "escape.txt"); symlinkSync(foreign, alias);
    const receipt = JSON.parse(readFileSync(input.source, "utf8"));
    input.criteria[0].evidence = [alias]; receipt.criteria[0].evidence = [alias];
    writeFileSync(input.source, JSON.stringify(receipt));
    assert.throws(() => goalAssess(f.id, input, f.p), /inside this repository/);
  });
});
