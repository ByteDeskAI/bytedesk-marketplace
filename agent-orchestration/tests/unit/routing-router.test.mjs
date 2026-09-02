import assert from "node:assert/strict";
import test from "node:test";

import { RoutingPolicyError, routeTask } from "../../src/policy/index.mjs";

test("design prefers Claude Fable at high effort", () => {
  const decision = routeTask("design");
  assert.equal(decision.status, "routed");
  assert.equal(decision.selected.providerId, "claude");
  assert.equal(decision.selected.modelId, "claude-fable-5-1");
  assert.equal(decision.selected.effort, "high");
});

test("implementation prefers Codex Sol and accepts an exact effort override", () => {
  const defaultDecision = routeTask("implementation");
  assert.equal(defaultDecision.selected.modelId, "gpt-5.6-sol");
  assert.equal(defaultDecision.selected.effort, "high");

  const maxDecision = routeTask("implementation", { effort: "max" });
  assert.equal(maxDecision.selected.modelId, "gpt-5.6-sol");
  assert.equal(maxDecision.selected.effort, "max");
});

test("Fable unavailability deterministically falls back to Opus", () => {
  const decision = routeTask("architecture", {
    availability: {
      providers: { claude: "available" },
      endpoints: {
        "claude.fable-5-1": "unavailable",
        "claude.opus-5": "unavailable",
        "claude.opus-4-8": "available",
      },
    },
    requireAvailable: true,
  });
  assert.equal(decision.selected.modelId, "claude-opus-4-8");
  assert.ok(
    decision.candidates
      .find((candidate) => candidate.endpointId === "claude.fable-5-1")
      .rejectionCodes.includes("MODEL_UNAVAILABLE"),
  );
});

test("unknown availability blocks execution when a live snapshot is required", () => {
  const decision = routeTask("implementation", { requireAvailable: true });
  assert.equal(decision.status, "routing_blocked");
  assert.equal(decision.selected, null);
  assert.ok(decision.candidates.every((candidate) => !candidate.eligible));
});

test("hard capabilities beat provider preference and unknown is not treated as supported", () => {
  const decision = routeTask("general", {
    alias: "provider.kimi.default",
    requiredCapabilities: ["workspace_write"],
  });
  assert.equal(decision.status, "routing_blocked");
  assert.deepEqual(decision.candidates[0].rejectionCodes, [
    "CAPABILITY_UNKNOWN:workspace_write",
  ]);
});

test("a probed capability override can make an explicit provider route eligible", () => {
  const decision = routeTask("general", {
    alias: "provider.kimi.default",
    requiredCapabilities: ["workspace_write"],
    capabilityOverrides: {
      kimi: { workspace_write: "supported" },
    },
  });
  assert.equal(decision.status, "routed");
  assert.equal(decision.selected.providerId, "kimi");
  assert.equal(decision.selected.modelId, null);
});

test("unsupported exact effort is rejected instead of clamped", () => {
  const decision = routeTask("general", {
    alias: "provider.kimi.default",
    effort: "high",
  });
  assert.equal(decision.status, "routing_blocked");
  assert.ok(decision.candidates[0].rejectionCodes.includes("EFFORT_UNSUPPORTED"));
});

test("frozen alias candidates are independent from mutable policy inputs", () => {
  const context = {
    alias: "implementation.default",
    frozenAliasCandidates: [{ endpointId: "claude.opus-4-8", effort: "high" }],
  };
  const first = routeTask("implementation", context);
  const second = routeTask("implementation", JSON.parse(JSON.stringify(context)));
  assert.equal(first.selected.modelId, "claude-opus-4-8");
  assert.equal(first.decisionId, second.decisionId);
  assert.deepEqual(first, second);
});

test("per-alias frozen snapshots are honored", () => {
  const decision = routeTask("design", {
    frozenAliases: {
      "design.default": [{ endpointId: "openai.gpt-5.6-sol", effort: "high" }],
    },
  });
  assert.equal(decision.selected.providerId, "codex");
  assert.deepEqual(decision.expandedAlias, [
    { endpointId: "openai.gpt-5.6-sol", effort: "high" },
  ]);
});

test("routing ties are deterministic by alias rank then candidate ID", () => {
  const decision = routeTask("general", {
    frozenAliasCandidates: [
      { endpointId: "claude.opus-4-8", effort: "medium" },
      { endpointId: "claude.fable-5-1", effort: "medium" },
    ],
  });
  assert.equal(decision.selected.endpointId, "claude.opus-4-8");
  assert.equal(decision.fallbackPath[0], decision.selected.candidateId);
});

test("invalid intent and alias produce stable contract errors", () => {
  assert.throws(
    () => routeTask("sales"),
    (error) => error instanceof RoutingPolicyError && error.code === "UNKNOWN_TASK_INTENT",
  );
  assert.throws(
    () => routeTask("general", { alias: "missing" }),
    (error) => error instanceof RoutingPolicyError && error.code === "UNKNOWN_ROUTING_ALIAS",
  );
});
