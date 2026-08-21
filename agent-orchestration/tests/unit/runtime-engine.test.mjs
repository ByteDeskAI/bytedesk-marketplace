import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionPlan } from "../../src/protocols/index.mjs";
import { runtimeInternals } from "../../src/runtime/engine.mjs";

const proposal = {
  decision: "choose A",
  constraints: ["durable"],
  options: ["A", "B"],
  recommendation: "A",
  risks: ["migration"],
  evidence: ["tests"],
};

function architectureOutputs(findings, dispositions, unresolvedFindings = []) {
  return [
    { stageId: "proposal", text: JSON.stringify(proposal) },
    { stageId: "critique", text: JSON.stringify({ findings, counterproposal: "B", acceptanceCriteria: ["verified"] }) },
    { stageId: "revision", text: JSON.stringify({ revisedDecision: "A2", dispositions, unresolvedFindings, rationale: "evidence", verification: ["tests"] }) },
  ];
}

test("architecture runtime retains Fable to Opus fallback and proposal-session reuse", () => {
  const plan = createExecutionPlan({ intent: "architecture" });
  const stages = runtimeInternals.planStages(plan);
  assert.deepEqual(stages[0].alternatives.map((candidate) => candidate.model), ["claude-fable-5", "claude-opus-4-8"]);
  assert.equal(stages[1].alternatives[0].model, "gpt-5.6-sol");
  assert.equal(stages[0].requiresPersistentSession, true);
  assert.equal(stages[1].requiresPersistentSession, false);
  assert.equal(stages[2].sessionSource, "proposal");
  assert.equal(stages[2].requiresPersistentSession, true);
  assert.equal(stages[3].internal, true);
});

test("fallback is limited to pre-turn model, effort, and session negotiation errors", () => {
  assert.equal(runtimeInternals.canFallbackBeforeTurn({ code: "REQUESTED_MODEL_UNSUPPORTED" }), true);
  assert.equal(runtimeInternals.canFallbackBeforeTurn({ code: "AO_PROVIDER_FAILED", message: "tool execution failed" }), false);
});

test("timeout classification is stable and separate from generic provider failure", () => {
  assert.equal(runtimeInternals.isTimeoutError({ code: "ACP_TURN_TIMEOUT" }), true);
  assert.equal(runtimeInternals.isTimeoutError({ message: "operation timed out" }), true);
  assert.equal(runtimeInternals.isTimeoutError({ code: "AO_PROVIDER_FAILED", message: "tool failed" }), false);
});

test("deterministic gate requires approval for unparseable or severe unresolved critique", () => {
  const unparseable = runtimeInternals.deterministicArchitectureGate([]);
  assert.equal(unparseable.requiresHumanApproval, true);
  const resolved = runtimeInternals.deterministicArchitectureGate(architectureOutputs(
    [{ findingId: "F-1", severity: "high", claim: "risk", evidence: "trace" }],
    [{ findingId: "F-1", status: "accepted", rationale: "fixed", evidence: "test" }],
  ));
  assert.equal(resolved.requiresHumanApproval, false);
});

test("deterministic gate correlates stable finding IDs and escalates severe disagreement", () => {
  const decision = runtimeInternals.deterministicArchitectureGate(architectureOutputs(
    [
      { findingId: "F-1", severity: "critical", claim: "unsafe", evidence: "trace" },
      { findingId: "F-2", severity: "low", claim: "cost", evidence: "estimate" },
    ],
    [{ findingId: "F-1", status: "rejected", rationale: "disagree", evidence: "benchmark" }],
  ));
  assert.equal(decision.requiresHumanApproval, true);
  assert.deepEqual(decision.unaddressedFindings, ["F-2"]);
  assert.equal(decision.severeCritique[0].findingId, "F-1");
});

test("deterministic gate fails closed on invalid fields and unknown dispositions", () => {
  const invalid = runtimeInternals.deterministicArchitectureGate([
    { stageId: "proposal", text: JSON.stringify(proposal) },
    { stageId: "critique", text: JSON.stringify({ findings: [{ findingId: "F-1", severity: "urgent", claim: "risk", evidence: "trace" }], counterproposal: "B", acceptanceCriteria: "test" }) },
    { stageId: "revision", text: JSON.stringify({ revisedDecision: "A", dispositions: [], unresolvedFindings: [], rationale: "none", verification: "none" }) },
  ]);
  assert.equal(invalid.requiresHumanApproval, true);
  assert.ok(invalid.contractErrors.includes("critique_contract_invalid"));

  const unknown = runtimeInternals.deterministicArchitectureGate(architectureOutputs(
    [{ findingId: "F-1", severity: "medium", claim: "risk", evidence: "trace" }],
    [
      { findingId: "F-1", status: "resolved", rationale: "fixed", evidence: "test" },
      { findingId: "F-9", status: "resolved", rationale: "invented", evidence: "none" },
    ],
  ));
  assert.equal(unknown.requiresHumanApproval, true);
  assert.deepEqual(unknown.unknownDispositions, ["F-9"]);
});
