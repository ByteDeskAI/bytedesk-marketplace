---
slug: go
displayName: Go
---

# Go

## Object Design Idioms
- Prefer small interfaces at consumers, functions, composition, and explicit construction.
- Many object-design patterns collapse into interfaces plus structs; avoid Java-style inheritance emulation.
- Use channels and context cancellation carefully; they do not replace durable messaging semantics.

## Integration Stacks
- Watermill
- NATS
- Kafka
- RabbitMQ
- Temporal
- gRPC

## Implementation Notes
- Prefer small consumer-owned interfaces, plain structs, functions, and explicit constructors; avoid inheritance-shaped ports.
- For Watermill, NATS, Kafka, RabbitMQ, Temporal, or gRPC flows, keep context cancellation, idempotency, and retry boundaries explicit.
- Use adapters at package boundaries and keep provider selection in composition code.

## Testing Guidance
- Use table tests for strategies and state transitions, contract tests for adapters, and focused integration tests for broker semantics.
- Test cancellation, retry, duplicate delivery, and timeout behavior where side effects occur.

## Operational Guidance
- Propagate context, correlation IDs, structured logs, metrics, and traces across handlers.
- Track consumer lag, retry counts, dead-letter totals, and handler latency with bounded retention policies.
