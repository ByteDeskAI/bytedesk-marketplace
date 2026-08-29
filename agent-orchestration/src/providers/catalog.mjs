/**
 * Static provider metadata. Runtime availability is deliberately separate and
 * is supplied to the router from doctor/probe results.
 */

export const PROVIDER_CATALOG_VERSION = "providers.v2";
export const MODEL_CATALOG_VERSION = "models.v2";

export const CAPABILITY_STATES = Object.freeze([
  "supported",
  "unsupported",
  "unknown",
]);

export const CAPABILITY_IDS = Object.freeze([
  "text_turn",
  "tools",
  "persistent_session",
  "steer",
  "workspace_read",
  "workspace_write",
  "image_input",
  "web_research",
  "large_context",
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

const commonAcpCapabilities = {
  text_turn: "supported",
  tools: "supported",
  persistent_session: "supported",
  steer: "unknown",
  workspace_read: "supported",
  workspace_write: "supported",
  image_input: "unknown",
  web_research: "unknown",
  large_context: "supported",
};

/**
 * Provider IDs are the only values callers may select. `agentTarget` is a
 * trusted ACPX registry key, never a caller-provided command string.
 */
export const PROVIDER_CATALOG = deepFreeze([
  {
    schemaVersion: 1,
    providerId: "claude",
    displayName: "Claude Code",
    driverId: "acpx",
    agentTarget: "claude",
    availability: "probe_required",
    capabilities: { ...commonAcpCapabilities },
  },
  {
    schemaVersion: 1,
    providerId: "codex",
    displayName: "Codex",
    driverId: "acpx",
    agentTarget: "codex",
    availability: "probe_required",
    // The bundled bridge advertises loadSession, but a real cross-process
    // resume currently fails. Keep follow-up unavailable until the live probe passes.
    capabilities: { ...commonAcpCapabilities, persistent_session: "unknown" },
  },
  {
    schemaVersion: 1,
    providerId: "grok-build",
    displayName: "Grok Build",
    driverId: "acpx",
    agentTarget: "grok-build",
    availability: "probe_required",
    capabilities: {
      text_turn: "supported",
      tools: "supported",
      persistent_session: "unknown",
      steer: "unknown",
      workspace_read: "supported",
      workspace_write: "supported",
      image_input: "unknown",
      web_research: "supported",
      large_context: "unknown",
    },
  },
  {
    schemaVersion: 1,
    providerId: "kimi",
    displayName: "Kimi CLI",
    driverId: "acpx",
    agentTarget: "kimi",
    availability: "probe_required",
    capabilities: {
      text_turn: "supported",
      tools: "supported",
      persistent_session: "unknown",
      steer: "unknown",
      workspace_read: "supported",
      workspace_write: "unknown",
      image_input: "unknown",
      web_research: "unknown",
      large_context: "supported",
    },
  },
]);

/**
 * Model endpoints are versioned routing metadata, not proof that the local CLI
 * is installed, entitled, or accepts the configured effort. Execution must use
 * a provider availability snapshot before starting a turn.
 */
export const MODEL_CATALOG = deepFreeze([
  {
    schemaVersion: 1,
    endpointId: "claude.opus-5",
    providerId: "claude",
    modelId: "claude-opus-5",
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "high",
    qualityClass: "frontier",
    latencyClass: "slow",
    costClass: "premium",
    intentAffinity: {
      architecture: 1,
      design: 1,
      implementation: 0.95,
      review: 0.95,
      general: 0.9,
    },
    provenance: "official_docs_then_runtime_probe",
  },
  {
    schemaVersion: 1,
    endpointId: "claude.fable-5",
    providerId: "claude",
    modelId: "claude-fable-5",
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "high",
    qualityClass: "frontier",
    latencyClass: "slow",
    costClass: "premium",
    intentAffinity: {
      architecture: 1,
      design: 1,
      implementation: 0.8,
      review: 0.9,
      general: 0.8,
    },
    provenance: "official_docs_then_runtime_probe",
  },
  {
    schemaVersion: 1,
    endpointId: "claude.opus-4-8",
    providerId: "claude",
    modelId: "claude-opus-4-8",
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "high",
    qualityClass: "frontier",
    latencyClass: "slow",
    costClass: "premium",
    intentAffinity: {
      architecture: 0.95,
      design: 0.95,
      implementation: 0.85,
      review: 0.9,
      general: 0.8,
    },
    provenance: "official_docs_then_runtime_probe",
  },
  {
    schemaVersion: 1,
    endpointId: "openai.gpt-5.6-sol",
    providerId: "codex",
    modelId: "gpt-5.6-sol",
    supportedEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
    qualityClass: "frontier",
    latencyClass: "moderate",
    costClass: "premium",
    intentAffinity: {
      architecture: 0.95,
      design: 0.9,
      implementation: 1,
      review: 1,
      test: 1,
      triage: 0.9,
      general: 0.85,
    },
    provenance: "official_docs_then_runtime_probe",
  },
  {
    schemaVersion: 1,
    endpointId: "grok-build.default",
    providerId: "grok-build",
    modelId: null,
    supportedEfforts: [],
    defaultEffort: null,
    qualityClass: "unknown",
    latencyClass: "unknown",
    costClass: "unknown",
    intentAffinity: {},
    provenance: "runtime_probe_required",
  },
  {
    schemaVersion: 1,
    endpointId: "kimi.default",
    providerId: "kimi",
    modelId: null,
    supportedEfforts: [],
    defaultEffort: null,
    qualityClass: "unknown",
    latencyClass: "unknown",
    costClass: "unknown",
    intentAffinity: {},
    provenance: "runtime_probe_required",
  },
]);

export function getProviderDescriptor(providerId) {
  return PROVIDER_CATALOG.find((provider) => provider.providerId === providerId) ?? null;
}

export function getModelDescriptor(endpointId) {
  return MODEL_CATALOG.find((model) => model.endpointId === endpointId) ?? null;
}
