function explainDecision(decision) {
  const selected = decision.selected;
  return {
    kind: "routing_explanation",
    schemaVersion: 1,
    decisionId: decision.decisionId,
    status: decision.status,
    summary: selected
      ? `Selected ${selected.providerId}/${selected.modelId ?? "provider-default"} at effort ${selected.effort ?? "provider-default"}.`
      : `Routing blocked: ${decision.blockedReason}.`,
    selected: selected
      ? {
          candidateId: selected.candidateId,
          providerId: selected.providerId,
          modelId: selected.modelId,
          effort: selected.effort,
          totalScore: selected.score.total,
          scoreComponents: selected.score.components,
        }
      : null,
    evaluatedCandidates: decision.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      eligible: candidate.eligible,
      rejectionCodes: candidate.rejectionCodes,
      totalScore: candidate.score.total,
      scoreComponents: candidate.score.components,
    })),
    fallbackPath: [...decision.fallbackPath],
    snapshots: {
      policySnapshotId: decision.policySnapshotId,
      availabilitySnapshotId: decision.availabilitySnapshotId,
    },
  };
}
export function getRoutingExplanation(plan) {
  if (plan?.kind === "routing_decision") return explainDecision(plan);
  if (plan?.kind !== "execution_plan" || !Array.isArray(plan.stages)) {
    throw new TypeError("Expected a RoutingDecisionV1 or ExecutionPlanV1");
  }
  return {
    kind: "execution_plan_explanation",
    schemaVersion: 1,
    planId: plan.planId,
    protocolId: plan.protocolId,
    status: plan.status,
    stages: plan.stages.map((stage) => ({
      stageId: stage.stageId,
      role: stage.role,
      selection: stage.route
        ? explainDecision(stage.route)
        : {
            kind: stage.selection.kind,
            sourceStageId: stage.selection.sourceStageId ?? null,
          },
    })),
  };
}
