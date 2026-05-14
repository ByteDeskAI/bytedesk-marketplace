---
slug: go-watermill-nats
name: Go / Watermill + NATS
domain: framework-pack
category: Framework Implementation Packs
groups:
  - framework-implementation
languages:
  - go
patterns:
  - message-router
  - event-message
  - command-message
  - competing-consumers
  - idempotent-receiver
  - dead-letter-channel
references:
  - skills/architecture-decision/references/implementation.md
  - skills/integration-flow-review/references/implementation.md
---

# Go / Watermill + NATS

## Best For
- Go services that need explicit message routing without heavyweight framework structure.
- NATS-backed event, command, and work-queue flows.
- Teams that value small interfaces, explicit construction, and observable handlers.

## Pattern Mapping
- Message Router maps to Watermill routers and handlers.
- Event Message and Command Message map to typed payloads plus subject naming.
- Competing Consumers map to queue groups where ordering permits.
- Idempotent Receiver remains explicit application state.
- Dead Letter Channel maps to a failure subject or stream with owned triage.

## Implementation Notes
- Keep handler dependencies explicit and pass context through every boundary.
- Define subject naming and payload versioning as part of the architecture.
- Bound retries and pair them with idempotency before scaling consumers.
- Keep adapters at package boundaries for NATS and external SDKs.

## Testing Guidance
- Use table tests for handlers and router decisions.
- Test cancellation, duplicate delivery, invalid payloads, and retry exhaustion.
- Use NATS-backed tests for queue group and durable stream behavior.

## Operational Guidance
- Track handler latency, retry counts, consumer lag, and failed-message subjects.
- Use structured logs with correlation IDs and subject names.
- Document stream retention, replay authorization, and poison-message handling.
