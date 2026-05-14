---
slug: dotnet-masstransit
name: .NET / MassTransit
domain: framework-pack
category: Framework Implementation Packs
groups:
  - framework-implementation
languages:
  - csharp
patterns:
  - event-message
  - command-message
  - publish-subscribe-channel
  - competing-consumers
  - idempotent-receiver
  - dead-letter-channel
references:
  - skills/architecture-decision/references/implementation.md
  - skills/integration-flow-review/references/implementation.md
---

# .NET / MassTransit

## Best For
- Event-driven and command-driven services in C#.
- Consumer scaling, retries, dead-letter handling, and broker abstraction.
- Teams already using dependency injection, hosted services, and structured observability.

## Pattern Mapping
- Event Message maps to published integration events.
- Command Message maps to `Send` or request-specific command contracts.
- Publish-Subscribe Channel maps to broker topics/exchanges managed through MassTransit topology.
- Competing Consumers map to scaled consumer instances.
- Idempotent Receiver remains application responsibility, usually backed by a durable store.
- Dead Letter Channel maps to error queues plus owned triage and replay policy.

## Implementation Notes
- Keep message contracts versioned and separate from domain entities.
- Put consumer idempotency near side-effect boundaries, not inside generic middleware only.
- Use receive endpoint configuration for retry policy, outbox, concurrency, and error routing.
- Prefer domain-named consumers and commands rather than transport vocabulary in business code.

## Testing Guidance
- Unit-test consumer behavior with duplicate message fixtures.
- Add contract tests for message payload compatibility.
- Use broker-backed tests for retry, error queue, and outbox behavior.

## Operational Guidance
- Track consumer lag, retry attempts, skipped messages, error queues, and handler latency.
- Propagate correlation IDs through headers and logs.
- Document dead-letter ownership, replay limits, and message retention policy.
