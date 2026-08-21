import { createHash } from "node:crypto";
import {
  MODEL_CATALOG_VERSION,
  PROVIDER_CATALOG_VERSION,
  getModelDescriptor,
  getProviderDescriptor,
} from "../providers/index.mjs";
import {
  DEFAULT_ALIAS_BY_INTENT,
  ROUTING_ALIASES,
  ROUTING_POLICY_VERSION,
  TASK_INTENTS,
} from "./catalog.mjs";

const QUALITY_SCORE = Object.freeze({ frontier: 15, balanced: 10, efficient: 5, unknown: 0 });
const LATENCY_SCORE = Object.freeze({ fast: 5, moderate: 3, slow: 1, unknown: 0 });
const COST_SCORE = Object.freeze({ economy: 5, standard: 3, premium: 1, unknown: 0 });

export class RoutingPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RoutingPolicyError";
    this.code = code;
  }
}

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
  const canonical = JSON.stringify(canonicalize(value));
  return `${prefix}_${createHash("sha256").update(canonical).digest("hex").slice(0, 20)}`;
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function resolveAlias(intent, context) {
  const alias = context.alias ?? DEFAULT_ALIAS_BY_INTENT[intent];
  const configured =
    context.frozenAliases?.[alias] ??
    context.frozenAliasCandidates ??
    ROUTING_ALIASES[alias];
  if (!alias || !configured) {
    throw new RoutingPolicyError("UNKNOWN_ROUTING_ALIAS", `Unknown routing alias: ${alias ?? "<none>"}`);
  }
  if (!Array.isArray(configured) || configured.length === 0) {
    throw new RoutingPolicyError("EMPTY_ROUTING_ALIAS", `Routing alias ${alias} has no candidates`);
  }
  return {
    alias,
    candidates: configured.map((candidate) => ({
      endpointId: candidate.endpointId,
      effort: candidate.effort ?? null,
    })),
  };
}

function availabilityStatus(context, providerId, endpointId) {
  const provider = context.availability?.providers?.[providerId] ?? "unknown";
  const endpoint = context.availability?.endpoints?.[endpointId] ?? "unknown";
  return { provider, endpoint };
}

function capabilityState(provider, capabilityId, context) {
  return (
    context.capabilityOverrides?.[provider.providerId]?.[capabilityId] ??
    provider.capabilities[capabilityId] ??
    "unknown"
  );
}

function scoreCandidate({ model, intent, aliasRank, context }) {
  const reliability = context.metrics?.[model.endpointId]?.reliability;
  const optimize = context.optimize ?? "quality";
  const components = {
    // Alias order is policy, not a weak suggestion. Metrics refine choices
    // within that policy but cannot silently overturn a capability-specialist
    // route such as Grok for research or Kimi for large context.
    policyPreference: Math.max(0, 100 - aliasRank * 25),
    intentAffinity: Math.round((model.intentAffinity[intent] ?? 0) * 30),
    quality: QUALITY_SCORE[model.qualityClass] ?? 0,
    reliability:
      typeof reliability === "number" && Number.isFinite(reliability)
        ? Math.max(0, Math.min(10, Math.round(reliability * 10)))
        : 0,
    latency:
      optimize === "latency" || optimize === "balanced"
        ? LATENCY_SCORE[model.latencyClass] ?? 0
        : 0,
    cost:
      optimize === "cost" || optimize === "balanced"
        ? COST_SCORE[model.costClass] ?? 0
        : 0,
  };
  return {
    components,
    total: Object.values(components).reduce((sum, value) => sum + value, 0),
  };
}

function evaluateCandidate({ candidate, aliasRank, intent, context }) {
  const rejectionCodes = [];
  const model = getModelDescriptor(candidate.endpointId);
  if (!model) {
    return {
      candidateId: `${candidate.endpointId}:${candidate.effort ?? "default"}`,
      endpointId: candidate.endpointId,
      providerId: null,
      modelId: null,
      effort: candidate.effort ?? null,
      aliasRank,
      eligible: false,
      rejectionCodes: ["POLICY_CANDIDATE_MISSING"],
      score: { total: 0, components: {} },
    };
  }

  const provider = getProviderDescriptor(model.providerId);
  if (!provider) rejectionCodes.push("PROVIDER_DESCRIPTOR_MISSING");

  const providerAllowlist = uniqueStrings(context.providerAllowlist);
  const providerDenylist = uniqueStrings(context.providerDenylist);
  const modelAllowlist = uniqueStrings(context.modelAllowlist);
  const modelDenylist = uniqueStrings(context.modelDenylist);
  const excludedProviders = uniqueStrings(context.excludedProviderIds);

  if (providerAllowlist.length > 0 && !providerAllowlist.includes(model.providerId)) {
    rejectionCodes.push("PROVIDER_NOT_ALLOWED");
  }
  if (providerDenylist.includes(model.providerId)) rejectionCodes.push("PROVIDER_DENIED");
  if (excludedProviders.includes(model.providerId)) rejectionCodes.push("DIVERSITY_CONFLICT");
  if (
    modelAllowlist.length > 0 &&
    !modelAllowlist.includes(model.endpointId) &&
    !modelAllowlist.includes(model.modelId)
  ) {
    rejectionCodes.push("MODEL_NOT_ALLOWED");
  }
  if (modelDenylist.includes(model.endpointId) || modelDenylist.includes(model.modelId)) {
    rejectionCodes.push("MODEL_DENIED");
  }

  const effort = context.effort ?? candidate.effort ?? model.defaultEffort ?? null;
  if (effort !== null && !model.supportedEfforts.includes(effort)) {
    rejectionCodes.push("EFFORT_UNSUPPORTED");
  }

  if (provider) {
    for (const capabilityId of uniqueStrings(context.requiredCapabilities)) {
      const state = capabilityState(provider, capabilityId, context);
      if (state === "unsupported") rejectionCodes.push(`CAPABILITY_UNSUPPORTED:${capabilityId}`);
      if (state !== "supported" && state !== "unsupported") {
        rejectionCodes.push(`CAPABILITY_UNKNOWN:${capabilityId}`);
      }
    }
  }

  const availability = availabilityStatus(context, model.providerId, model.endpointId);
  if (availability.provider === "unavailable") rejectionCodes.push("PROVIDER_UNAVAILABLE");
  if (availability.endpoint === "unavailable") rejectionCodes.push("MODEL_UNAVAILABLE");
  if (context.requireAvailable === true) {
    if (availability.provider === "unknown") rejectionCodes.push("PROVIDER_AVAILABILITY_UNKNOWN");
    if (availability.endpoint === "unknown") rejectionCodes.push("MODEL_AVAILABILITY_UNKNOWN");
  }

  const score = scoreCandidate({ model, intent, aliasRank, context });
  return {
    candidateId: `${model.endpointId}:${effort ?? "default"}`,
    endpointId: model.endpointId,
    providerId: model.providerId,
    driverId: provider?.driverId ?? null,
    agentTarget: provider?.agentTarget ?? null,
    modelId: model.modelId,
    effort,
    aliasRank,
    availability,
    eligible: rejectionCodes.length === 0,
    rejectionCodes,
    score,
  };
}

/**
 * Deterministic, capability-aware route selection. Context is expected to be a
 * plain JSON object so the resulting decision can be journaled and replayed.
 */
export function routeTask(intent, context = {}) {
  if (!TASK_INTENTS.includes(intent)) {
    throw new RoutingPolicyError("UNKNOWN_TASK_INTENT", `Unknown task intent: ${String(intent)}`);
  }
  const expandedAlias = resolveAlias(intent, context);
  const candidates = expandedAlias.candidates.map((candidate, aliasRank) =>
    evaluateCandidate({ candidate, aliasRank, intent, context }),
  );

  const eligible = candidates
    .filter((candidate) => candidate.eligible)
    .sort(
      (left, right) =>
        right.score.total - left.score.total ||
        left.aliasRank - right.aliasRank ||
        left.candidateId.localeCompare(right.candidateId),
    );

  const availabilitySnapshot = context.availability ?? { providers: {}, endpoints: {} };
  const decisionBody = {
    kind: "routing_decision",
    schemaVersion: 1,
    policyVersion: ROUTING_POLICY_VERSION,
    providerCatalogVersion: PROVIDER_CATALOG_VERSION,
    modelCatalogVersion: MODEL_CATALOG_VERSION,
    policySnapshotId: context.policySnapshotId ?? `policy:${ROUTING_POLICY_VERSION}`,
    availabilitySnapshotId:
      context.availabilitySnapshotId ?? stableId("availability", availabilitySnapshot),
    intent,
    alias: expandedAlias.alias,
    expandedAlias: expandedAlias.candidates,
    constraints: {
      providerAllowlist: uniqueStrings(context.providerAllowlist),
      providerDenylist: uniqueStrings(context.providerDenylist),
      modelAllowlist: uniqueStrings(context.modelAllowlist),
      modelDenylist: uniqueStrings(context.modelDenylist),
      excludedProviderIds: uniqueStrings(context.excludedProviderIds),
      requiredCapabilities: uniqueStrings(context.requiredCapabilities),
      effort: context.effort ?? null,
      requireAvailable: context.requireAvailable === true,
      optimize: context.optimize ?? "quality",
    },
    candidates,
    selected: eligible[0] ?? null,
    fallbackPath: eligible.map((candidate) => candidate.candidateId),
    status: eligible.length > 0 ? "routed" : "routing_blocked",
    blockedReason: eligible.length > 0 ? null : "NO_ELIGIBLE_CANDIDATE",
  };

  return {
    ...decisionBody,
    decisionId: stableId("route", decisionBody),
  };
}
