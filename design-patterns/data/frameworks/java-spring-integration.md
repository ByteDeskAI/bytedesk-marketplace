---
slug: java-spring-integration
name: Java / Spring Integration
domain: framework-pack
category: Framework Implementation Packs
groups:
  - framework-implementation
languages:
  - java
patterns:
  - message-channel
  - message-router
  - content-based-router
  - splitter
  - aggregator
  - service-activator
references:
  - skills/architecture-decision/references/implementation.md
  - skills/integration-flow-review/references/implementation.md
---

# Java / Spring Integration

## Best For
- Enterprise message flows inside JVM systems.
- Explicit channels, routers, transformers, splitters, aggregators, and service activators.
- Teams that want integration flow definitions close to Spring configuration.

## Pattern Mapping
- Message Channel maps to Spring Integration channels.
- Content-Based Router maps to router components or integration flow route definitions.
- Splitter and Aggregator map to first-class flow operators.
- Service Activator maps to method invocation from a channel.
- Message Translator maps to transformers and converters.

## Implementation Notes
- Keep business decisions in domain services and transport decisions in flow configuration.
- Name channels after business flow roles, not only broker mechanics.
- Use error channels, retry advice, and transaction boundaries deliberately.
- Avoid turning integration configuration into the hidden owner of domain policy.

## Testing Guidance
- Unit-test routers and transformers with representative messages.
- Use Spring slice tests for flow wiring.
- Exercise error channel and retry behavior with controlled failures.

## Operational Guidance
- Expose channel metrics, handler latency, flow errors, and correlation IDs.
- Document ownership for flow changes, schema changes, and replay operations.
- Treat complex route definitions as production logic that deserves review.
