import { createHash } from "node:crypto";
import { routeTask } from "../policy/index.mjs";
import { PROTOCOL_DEFINITIONS, PROTOCOL_VERSION, validateProtocolDefinition } from "./definitions.mjs";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function stableId(prefix, value) {
  return `${prefix}_${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")
    .slice(0, 20)}`;
}

function mergedContext(context, overrides) {
  return {
    ...context,
    ...overrides,
    availability: context.availability,
    capabilityOverrides: context.capabilityOverrides,
    metrics: context.metrics,
  };
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

export function deriveExecutionCapabilities(input = {}, context = {}, protocol = undefined) {
  const permissionProfile = input.permissionProfile ?? context.permissionProfile ?? "read";
  if (!["read", "write"].includes(permissionProfile)) {
    throw new RangeError(`Unknown permission profile: ${String(permissionProfile)}`);
  }
  const activeProtocol = protocol ?? PROTOCOL_DEFINITIONS[
    input.protocolId ?? (input.intent === "architecture" ? "architecture.adversarial.v1" : "single.v1")
  ];
  const requiresPersistentSession = input.sessionMode === "persistent" || activeProtocol?.stages?.some((stage) =>
    stage.selection?.kind === "persistent_session",
  );
  return uniqueStrings([
    ...(context.requiredCapabilities ?? []),
    ...(input.routing?.requiredCapabilities ?? []),
    ...(input.requiredCapabilities ?? []),
    permissionProfile === "write" ? "tools" : null,
    permissionProfile === "write" ? "workspace_write" : "workspace_read",
    requiresPersistentSession ? "persistent_session" : null,
  ]);
}

function createGenericPlan(input, context, protocol) {
  const sessionSourceIds = new Set(protocol.stages
    .filter((stage) => stage.selection?.kind === "reuse_stage_session")
    .map((stage) => stage.selection.sourceStageId));
  const stages = protocol.stages.map((definition) => {
    if (definition.selection?.kind !== "route") return { ...definition };
    const route = routeTask(input.intent, {
      ...context,
      ...(definition.selection.alias ? { alias: definition.selection.alias } : {}),
      requiredCapabilities: uniqueStrings([
        ...(context.requiredCapabilities ?? []),
        sessionSourceIds.has(definition.stageId) ? "persistent_session" : null,
      ]),
    });
    return { ...definition, route };
  });
  return {
    protocol,
    stages,
    status: stages.every((stage) => !stage.route || stage.route.status === "routed") ? "ready" : "routing_blocked",
  };
}

function createArchitecturePlan(input, context, protocol) {
  const shared = { ...context };
  const proposal = routeTask(
    "architecture",
    mergedContext(shared, {
      alias: "architecture.proposal",
      effort: "max",
      frozenAliasCandidates: shared.frozenAliases?.["architecture.proposal"],
      requiredCapabilities: uniqueStrings([...(shared.requiredCapabilities ?? []), "persistent_session"]),
    }),
  );
  const proposalProvider = proposal.selected?.providerId;
  const critique = routeTask(
    "architecture",
    mergedContext(shared, {
      alias: "architecture.critique",
      effort: "max",
      frozenAliasCandidates: shared.frozenAliases?.["architecture.critique"],
      excludedProviderIds: proposalProvider
        ? [...new Set([...(shared.excludedProviderIds ?? []), proposalProvider])]
        : shared.excludedProviderIds,
    }),
  );

  const stages = protocol.stages.map((definition) => {
    if (definition.stageId === "proposal") return { ...definition, route: proposal };
    if (definition.stageId === "critique") return { ...definition, route: critique };
    return { ...definition };
  });
  return {
    protocol,
    stages,
    status:
      proposal.status === "routed" && critique.status === "routed"
        ? "ready"
        : "routing_blocked",
  };
}

/**
 * Build a deterministic execution plan. Architecture work uses the adversarial
 * Claude proposal -> Codex critique -> same-Claude revision protocol by default.
 */
export function createExecutionPlan(input, context = {}) {
  if (!input || typeof input !== "object") throw new TypeError("ExecutionPlanInput is required");
  const protocolId =
    input.protocolId ??
    (input.intent === "architecture" ? "architecture.adversarial.v1" : "single.v1");
  if (typeof protocolId !== "string" || protocolId.length === 0) throw new TypeError("protocolId must be a non-empty string");
  const registeredProtocol = PROTOCOL_DEFINITIONS[protocolId];
  const protocol = registeredProtocol ? validateProtocolDefinition(registeredProtocol, protocolId) : null;
  if (!protocol) throw new RangeError(`Unknown protocol: ${protocolId}`);
  if (protocolId === "architecture.adversarial.v1" && input.intent !== "architecture") {
    throw new RangeError("architecture.adversarial.v1 requires architecture intent");
  }

  const routingContext = {
    ...context,
    ...(input.routing ?? {}),
    permissionProfile: input.permissionProfile ?? context.permissionProfile ?? "read",
    requiredCapabilities: deriveExecutionCapabilities(input, context, protocol),
  };
  const planned =
    protocolId === "architecture.adversarial.v1"
      ? createArchitecturePlan(input, routingContext, protocol)
      : createGenericPlan(input, routingContext, protocol);
  const body = {
    kind: "execution_plan",
    schemaVersion: 1,
    protocolVersion: PROTOCOL_VERSION,
    protocolId,
    intent: input.intent,
    status: planned.status,
    stages: planned.stages,
  };
  return {
    ...body,
    planId: stableId("plan", body),
  };
}
