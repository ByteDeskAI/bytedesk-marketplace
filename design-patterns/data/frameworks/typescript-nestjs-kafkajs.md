---
slug: typescript-nestjs-kafkajs
name: TypeScript / NestJS + KafkaJS
domain: framework-pack
category: Framework Implementation Packs
groups:
  - framework-implementation
languages:
  - typescript
patterns:
  - event-message
  - command-message
  - content-based-router
  - idempotent-receiver
  - message-history
  - dead-letter-channel
references:
  - skills/architecture-decision/references/implementation.md
  - skills/integration-flow-review/references/implementation.md
---

# TypeScript / NestJS + KafkaJS

## Best For
- Typed Node.js services with message handlers, HTTP boundaries, and event streams.
- Teams that want framework conventions but still need explicit Kafka ownership.
- Event fanout, command handling, and consumer hardening.

## Pattern Mapping
- Event Message maps to typed event contracts with schema/version fields.
- Content-Based Router maps to handler dispatch based on topic, headers, or domain fields.
- Idempotent Receiver is implemented with durable processed-message state.
- Message History maps to propagated metadata and structured trace fields.
- Dead Letter Channel maps to retry topics, error topics, or owned quarantine streams.

## Implementation Notes
- Keep DTOs, schemas, and domain models separate.
- Put idempotency and validation before side effects.
- Use discriminated unions or runtime schema validation for message shape.
- Keep provider-specific KafkaJS code in boundary modules.

## Testing Guidance
- Test handler functions with duplicate, malformed, and stale message fixtures.
- Add contract tests for payload compatibility and version handling.
- Use integration tests for consumer group, retry, and dead-letter behavior.

## Operational Guidance
- Track consumer lag, retry topics, error-topic volume, handler duration, and correlation IDs.
- Propagate trace context through message headers.
- Document replay procedures and privacy limits for payload inspection.
