function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const ROUTING_POLICY_VERSION = "routing-policy.v2";

export const TASK_INTENTS = Object.freeze([
  "architecture",
  "design",
  "implementation",
  "review",
  "research",
  "test",
  "documentation",
  "operations",
  "triage",
  "general",
]);

export const ROUTING_ALIASES = deepFreeze({
  "architecture.proposal": [
    { endpointId: "claude.fable-5-1", effort: "max" },
    { endpointId: "claude.opus-5", effort: "max" },
    { endpointId: "claude.opus-4-8", effort: "max" },
  ],
  "architecture.critique": [
    { endpointId: "openai.gpt-5.6-sol", effort: "max" },
  ],
  "design.default": [
    { endpointId: "claude.fable-5-1", effort: "high" },
    { endpointId: "claude.opus-5", effort: "high" },
    { endpointId: "claude.opus-4-8", effort: "high" },
    { endpointId: "openai.gpt-5.6-sol", effort: "high" },
  ],
  "implementation.default": [
    { endpointId: "openai.gpt-5.6-sol", effort: "high" },
    { endpointId: "claude.fable-5-1", effort: "high" },
    { endpointId: "claude.opus-5", effort: "high" },
    { endpointId: "claude.opus-4-8", effort: "high" },
  ],
  "review.default": [
    { endpointId: "openai.gpt-5.6-sol", effort: "high" },
    { endpointId: "claude.opus-5", effort: "high" },
    { endpointId: "claude.opus-4-8", effort: "high" },
  ],
  "research.default": [
    { endpointId: "grok-build.default", effort: null },
    { endpointId: "openai.gpt-5.6-sol", effort: "high" },
    { endpointId: "claude.opus-5", effort: "high" },
  ],
  "general.default": [
    { endpointId: "openai.gpt-5.6-sol", effort: "medium" },
    { endpointId: "claude.opus-5", effort: "medium" },
    { endpointId: "claude.opus-4-8", effort: "medium" },
  ],
  "provider.grok-build.default": [
    { endpointId: "grok-build.default", effort: null },
  ],
  "provider.kimi.default": [
    { endpointId: "kimi.default", effort: null },
  ],
  "provider.claude.default": [
    { endpointId: "claude.fable-5-1", effort: "high" },
    { endpointId: "claude.opus-5", effort: "high" },
    { endpointId: "claude.opus-4-8", effort: "high" },
  ],
  "provider.codex.default": [
    { endpointId: "openai.gpt-5.6-sol", effort: "high" },
  ],
});

export const DEFAULT_ALIAS_BY_INTENT = deepFreeze({
  architecture: "architecture.proposal",
  design: "design.default",
  implementation: "implementation.default",
  review: "review.default",
  research: "research.default",
  test: "implementation.default",
  documentation: "design.default",
  operations: "implementation.default",
  triage: "review.default",
  general: "general.default",
});
