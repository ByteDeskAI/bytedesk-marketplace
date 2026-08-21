import assert from "node:assert/strict";
import test from "node:test";

import { getRoutingExplanation } from "../../src/policy/index.mjs";
import {
  createExecutionPlan,
  deriveExecutionCapabilities,
  validateProtocolDefinition,
} from "../../src/protocols/index.mjs";

test("architecture plan is adversarial, cross-provider, max effort, and session-stable", () => {
  const plan = createExecutionPlan({ intent: "architecture" });
  assert.equal(plan.protocolId, "architecture.adversarial.v1");
  assert.equal(plan.status, "ready");
  assert.deepEqual(
    plan.stages.map((stage) => stage.stageId),
    ["proposal", "critique", "revision", "decision_gate"],
  );

  const proposal = plan.stages.find((stage) => stage.stageId === "proposal");
  const critique = plan.stages.find((stage) => stage.stageId === "critique");
  const revision = plan.stages.find((stage) => stage.stageId === "revision");
  assert.equal(proposal.route.selected.providerId, "claude");
  assert.equal(proposal.route.selected.effort, "max");
  assert.equal(critique.route.selected.providerId, "codex");
  assert.equal(critique.route.selected.effort, "max");
  assert.equal(revision.selection.kind, "reuse_stage_session");
  assert.equal(revision.selection.sourceStageId, "proposal");
});

test("architecture blocks when the required independent Sol adversary is unavailable", () => {
  const plan = createExecutionPlan(
    { intent: "architecture" },
    {
      availability: {
        providers: { claude: "available", codex: "unavailable" },
        endpoints: {
          "claude.fable-5": "available",
          "claude.opus-4-8": "available",
          "openai.gpt-5.6-sol": "unavailable",
        },
      },
      requireAvailable: true,
    },
  );
  assert.equal(plan.status, "routing_blocked");
  assert.equal(
    plan.stages.find((stage) => stage.stageId === "critique").route.status,
    "routing_blocked",
  );
});

test("non-architecture intent uses the single protocol", () => {
  const plan = createExecutionPlan({ intent: "implementation" });
  assert.equal(plan.protocolId, "single.v1");
  assert.equal(plan.stages.length, 1);
  assert.equal(plan.stages[0].route.selected.modelId, "gpt-5.6-sol");
});

test("architecture protocol rejects a contradictory intent", () => {
  assert.throws(
    () =>
      createExecutionPlan({
        intent: "design",
        protocolId: "architecture.adversarial.v1",
      }),
    /requires architecture intent/,
  );
});

test("architecture uses separate frozen aliases for proposal and critique", () => {
  const plan = createExecutionPlan(
    { intent: "architecture" },
    {
      frozenAliases: {
        "architecture.proposal": [{ endpointId: "claude.opus-4-8", effort: "max" }],
        "architecture.critique": [{ endpointId: "openai.gpt-5.6-sol", effort: "max" }],
      },
    },
  );
  assert.equal(plan.stages[0].route.selected.modelId, "claude-opus-4-8");
  assert.equal(plan.stages[1].route.selected.modelId, "gpt-5.6-sol");
});

test("execution plans and explanations are deterministic and JSON serializable", () => {
  const first = createExecutionPlan({ intent: "architecture" });
  const second = createExecutionPlan({ intent: "architecture" });
  assert.deepEqual(first, second);
  assert.doesNotThrow(() => JSON.stringify(first));

  const explanation = getRoutingExplanation(first);
  assert.equal(explanation.kind, "execution_plan_explanation");
  assert.equal(explanation.stages.length, 4);
  assert.doesNotThrow(() => JSON.stringify(explanation));
});

test("protocol definitions are validated and deterministically topologically ordered", () => {
  const protocol = validateProtocolDefinition({
    schemaVersion: 1,
    protocolId: "review-pair.v1",
    stages: [
      { stageId: "synthesis", role: "synthesizer", dependsOn: ["review-a", "review-b"], selection: { kind: "route" }, outputContract: "agent-output.text.v1" },
      { stageId: "review-b", role: "reviewer", dependsOn: [], selection: { kind: "route" }, outputContract: "agent-output.text.v1" },
      { stageId: "review-a", role: "reviewer", dependsOn: [], selection: { kind: "route" }, outputContract: "agent-output.text.v1" },
    ],
  });
  assert.deepEqual(protocol.stages.map((stage) => stage.stageId), ["review-b", "review-a", "synthesis"]);
});

test("protocol validation rejects duplicate, missing, and cyclic dependencies with clear errors", () => {
  assert.throws(
    () => validateProtocolDefinition({ protocolId: "duplicate.v1", stages: [
      { stageId: "same", dependsOn: [], selection: { kind: "route" }, outputContract: "agent-output.text.v1" },
      { stageId: "same", dependsOn: [], selection: { kind: "route" }, outputContract: "agent-output.text.v1" },
    ] }),
    /duplicate stageId 'same'/,
  );
  assert.throws(
    () => validateProtocolDefinition({ protocolId: "missing.v1", stages: [
      { stageId: "only", dependsOn: ["absent"], selection: { kind: "route" }, outputContract: "agent-output.text.v1" },
    ] }),
    /depends on unknown stage 'absent'/,
  );
  assert.throws(
    () => validateProtocolDefinition({ protocolId: "cycle.v1", stages: [
      { stageId: "left", dependsOn: ["right"], selection: { kind: "route" }, outputContract: "agent-output.text.v1" },
      { stageId: "right", dependsOn: ["left"], selection: { kind: "route" }, outputContract: "agent-output.text.v1" },
    ] }),
    /dependency cycle detected among: left, right/,
  );
});

test("protocol validation rejects unregistered executors and internal output contracts", () => {
  assert.throws(() => validateProtocolDefinition({ protocolId: "unknown.v1", stages: [
    { stageId: "run", dependsOn: [], selection: { kind: "shell" }, outputContract: "agent-output.text.v1" },
  ] }), /unsupported executor 'shell'/);
  assert.throws(() => validateProtocolDefinition({ protocolId: "bad-gate.v1", stages: [
    { stageId: "gate", dependsOn: [], selection: { kind: "deterministic_gate" }, outputContract: "custom.gate.v1" },
  ] }), /does not implement output contract 'custom.gate.v1'/);
});

test("execution requirements derive hard workspace and session capabilities", () => {
  assert.deepEqual(
    deriveExecutionCapabilities({ intent: "implementation", permissionProfile: "read" }),
    ["workspace_read"],
  );
  assert.deepEqual(
    deriveExecutionCapabilities({ intent: "implementation", permissionProfile: "write" }),
    ["tools", "workspace_write"],
  );
  const architecture = createExecutionPlan({ intent: "architecture", permissionProfile: "read" });
  assert.deepEqual(architecture.stages[0].route.constraints.requiredCapabilities, ["workspace_read", "persistent_session"]);
  assert.deepEqual(architecture.stages[1].route.constraints.requiredCapabilities, ["workspace_read"]);
  const persistent = createExecutionPlan({ intent: "implementation", permissionProfile: "read", sessionMode: "persistent", routing: { alias: "provider.codex.default" } });
  assert.equal(persistent.status, "routing_blocked", "Codex follow-up must remain unavailable until cross-process resume passes live verification");
  assert.ok(persistent.stages[0].route.candidates[0].rejectionCodes.includes("CAPABILITY_UNKNOWN:persistent_session"));
});

test("write routing admits proven Grok tools but rejects unknown Kimi write capability", () => {
  const grok = createExecutionPlan({
    intent: "research",
    permissionProfile: "write",
    routing: { alias: "provider.grok-build.default" },
  });
  assert.equal(grok.status, "ready");
  assert.equal(grok.stages[0].route.selected.providerId, "grok-build");
  assert.deepEqual(grok.stages[0].route.constraints.requiredCapabilities, ["tools", "workspace_write"]);

  const kimi = createExecutionPlan({
    intent: "general",
    permissionProfile: "write",
    routing: { alias: "provider.kimi.default" },
  });
  assert.equal(kimi.status, "routing_blocked");
  assert.ok(kimi.stages[0].route.candidates[0].rejectionCodes.includes("CAPABILITY_UNKNOWN:workspace_write"));
});

test("protocolId rejects non-string and unknown public values", () => {
  assert.throws(() => createExecutionPlan({ intent: "general", protocolId: 7 }), /protocolId must be a non-empty string/);
  assert.throws(() => createExecutionPlan({ intent: "general", protocolId: "missing.v1" }), /Unknown protocol: missing.v1/);
});
