function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const PROTOCOL_VERSION = "protocols.v2";

const STAGE_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
export const STAGE_EXECUTOR_KINDS = Object.freeze(["route", "reuse_stage_session", "persistent_session", "deterministic_gate"]);
const INTERNAL_EXECUTOR_CONTRACTS = Object.freeze({
  deterministic_gate: new Set(["architecture.disposition-matrix.v1"]),
});

function protocolError(protocolId, message) {
  return new RangeError(`Invalid protocol ${protocolId}: ${message}`);
}

/**
 * Validate a declarative protocol and return a cloned definition whose stages
 * are in deterministic topological order. This keeps declaration order as the
 * tie-breaker for independent stages, so plans and plan IDs remain stable.
 */
export function validateProtocolDefinition(definition, expectedProtocolId = undefined) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new TypeError("Protocol definition must be an object");
  }
  const protocolId = definition.protocolId;
  if (typeof protocolId !== "string" || protocolId.length === 0) {
    throw protocolError(expectedProtocolId ?? "<unknown>", "protocolId must be a non-empty string");
  }
  if (expectedProtocolId !== undefined && protocolId !== expectedProtocolId) {
    throw protocolError(protocolId, `definition key '${expectedProtocolId}' does not match protocolId`);
  }
  if (!Array.isArray(definition.stages) || definition.stages.length === 0) {
    throw protocolError(protocolId, "stages must be a non-empty array");
  }

  const stages = definition.stages.map((stage, index) => {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
      throw protocolError(protocolId, `stage at index ${index} must be an object`);
    }
    if (typeof stage.stageId !== "string" || !STAGE_ID.test(stage.stageId)) {
      throw protocolError(protocolId, `stage at index ${index} has invalid stageId '${String(stage.stageId)}'`);
    }
    if (!Array.isArray(stage.dependsOn) || stage.dependsOn.some((dependency) => typeof dependency !== "string" || !STAGE_ID.test(dependency))) {
      throw protocolError(protocolId, `stage '${stage.stageId}' dependsOn must contain only valid stage IDs`);
    }
    const selectionKind = stage.selection?.kind;
    if (!STAGE_EXECUTOR_KINDS.includes(selectionKind)) {
      throw protocolError(protocolId, `stage '${stage.stageId}' declares unsupported executor '${String(selectionKind)}'`);
    }
    if (typeof stage.outputContract !== "string" || stage.outputContract.length === 0) {
      throw protocolError(protocolId, `stage '${stage.stageId}' must declare outputContract`);
    }
    const executorContracts = INTERNAL_EXECUTOR_CONTRACTS[selectionKind];
    if (executorContracts && !executorContracts.has(stage.outputContract)) {
      throw protocolError(protocolId, `stage '${stage.stageId}' executor '${selectionKind}' does not implement output contract '${stage.outputContract}'`);
    }
    return { ...stage, dependsOn: [...stage.dependsOn] };
  });
  const stageById = new Map();
  for (const stage of stages) {
    if (stageById.has(stage.stageId)) throw protocolError(protocolId, `duplicate stageId '${stage.stageId}'`);
    stageById.set(stage.stageId, stage);
  }
  for (const stage of stages) {
    const seenDependencies = new Set();
    for (const dependency of stage.dependsOn) {
      if (!stageById.has(dependency)) throw protocolError(protocolId, `stage '${stage.stageId}' depends on unknown stage '${dependency}'`);
      if (dependency === stage.stageId) throw protocolError(protocolId, `stage '${stage.stageId}' cannot depend on itself`);
      if (seenDependencies.has(dependency)) throw protocolError(protocolId, `stage '${stage.stageId}' repeats dependency '${dependency}'`);
      seenDependencies.add(dependency);
    }
    if (stage.selection?.kind === "reuse_stage_session") {
      const sourceStageId = stage.selection.sourceStageId;
      if (typeof sourceStageId !== "string" || !stageById.has(sourceStageId)) {
        throw protocolError(protocolId, `stage '${stage.stageId}' reuses unknown source stage '${String(sourceStageId)}'`);
      }
      if (!stage.dependsOn.includes(sourceStageId)) {
        throw protocolError(protocolId, `stage '${stage.stageId}' must depend on reused source stage '${sourceStageId}'`);
      }
    }
  }

  const order = new Map(stages.map((stage, index) => [stage.stageId, index]));
  const indegree = new Map(stages.map((stage) => [stage.stageId, stage.dependsOn.length]));
  const dependents = new Map(stages.map((stage) => [stage.stageId, []]));
  for (const stage of stages) {
    for (const dependency of stage.dependsOn) dependents.get(dependency).push(stage.stageId);
  }
  const ready = stages.filter((stage) => indegree.get(stage.stageId) === 0);
  const ordered = [];
  while (ready.length > 0) {
    ready.sort((left, right) => order.get(left.stageId) - order.get(right.stageId));
    const stage = ready.shift();
    ordered.push(stage);
    for (const dependentId of dependents.get(stage.stageId)) {
      const nextIndegree = indegree.get(dependentId) - 1;
      indegree.set(dependentId, nextIndegree);
      if (nextIndegree === 0) ready.push(stageById.get(dependentId));
    }
  }
  if (ordered.length !== stages.length) {
    const cycleStageIds = stages.filter((stage) => indegree.get(stage.stageId) > 0).map((stage) => stage.stageId);
    throw protocolError(protocolId, `stage dependency cycle detected among: ${cycleStageIds.join(", ")}`);
  }
  return { ...definition, stages: ordered };
}

const definitions = {
  "single.v1": {
    schemaVersion: 1,
    protocolId: "single.v1",
    stages: [
      {
        stageId: "execute",
        role: "executor",
        dependsOn: [],
        selection: { kind: "route" },
        outputContract: "agent-output.text.v1",
      },
    ],
  },
  "architecture.adversarial.v1": {
    schemaVersion: 1,
    protocolId: "architecture.adversarial.v1",
    invariants: {
      proposalProviderFamily: "claude",
      critiqueProviderFamily: "codex",
      requireProviderDiversity: true,
      revisionReusesProposalSession: true,
      unresolvedHighSeverityDisposition: "waiting_for_decision",
    },
    stages: [
      {
        stageId: "proposal",
        role: "proposer",
        dependsOn: [],
        selection: { kind: "route", alias: "architecture.proposal" },
        outputContract: "architecture.proposal.v1",
      },
      {
        stageId: "critique",
        role: "adversary",
        dependsOn: ["proposal"],
        selection: { kind: "route", alias: "architecture.critique" },
        inputArtifacts: ["proposal.output"],
        outputContract: "architecture.critique.v1",
      },
      {
        stageId: "revision",
        role: "reviser",
        dependsOn: ["proposal", "critique"],
        selection: { kind: "reuse_stage_session", sourceStageId: "proposal" },
        inputArtifacts: ["proposal.output", "critique.output"],
        outputContract: "architecture.revision.v1",
      },
      {
        stageId: "decision_gate",
        role: "gate",
        dependsOn: ["revision"],
        selection: { kind: "deterministic_gate" },
        inputArtifacts: ["critique.output", "revision.output"],
        outputContract: "architecture.disposition-matrix.v1",
      },
    ],
  },
};

export const PROTOCOL_DEFINITIONS = deepFreeze(Object.fromEntries(
  Object.entries(definitions).map(([protocolId, definition]) => [
    protocolId,
    validateProtocolDefinition(definition, protocolId),
  ]),
));
