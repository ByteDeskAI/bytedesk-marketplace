---
slug: csharp
displayName: C# / .NET
---

# C# / .NET

## Object Design Idioms
- Prefer interfaces, records, delegates, extension methods, and dependency injection before adding pattern machinery.
- Use factories and strategies at composition boundaries; keep domain code free of container dependencies.
- Use async streams, channels, hosted services, and middleware pipelines for workflow-style patterns.

## Integration Stacks
- MassTransit
- NServiceBus
- Wolverine
- Azure Service Bus
- RabbitMQ
- Kafka

## Implementation Notes
- Use interfaces, delegates, records, middleware, hosted services, and dependency-injection lifetimes deliberately; keep domain code independent from container APIs.
- Prefer MassTransit, NServiceBus, Wolverine, Azure Service Bus, RabbitMQ, or Kafka primitives for integration patterns instead of hand-rolled dispatch loops.
- Model provider or infrastructure boundaries with adapters and bridges that translate errors, cancellation, retries, and telemetry into domain terms.

## Testing Guidance
- Use behavior tests around public services, contract tests for provider adapters, and duplicate-delivery tests for message consumers.
- Prefer test doubles at domain-owned interfaces; use broker or container-backed tests only for flow semantics that mocks cannot prove.

## Operational Guidance
- Use structured logs, Activity tracing, correlation IDs, health checks, and dead-letter dashboards for integration flows.
- Document retry, idempotency, and replay behavior beside the consumer or hosted service that owns it.
