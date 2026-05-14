---
slug: python-celery-faststream
name: Python / Celery + FastStream
domain: framework-pack
category: Framework Implementation Packs
groups:
  - framework-implementation
languages:
  - python
patterns:
  - command-message
  - event-message
  - polling-consumer
  - event-driven-consumer
  - idempotent-receiver
  - message-expiration
references:
  - skills/architecture-decision/references/implementation.md
  - skills/integration-flow-review/references/implementation.md
---

# Python / Celery + FastStream

## Best For
- Python systems with background jobs, message handlers, and asynchronous integrations.
- Teams that want lightweight handlers with explicit retry, idempotency, and serialization policy.
- Workflows where task identity and payload compatibility matter.

## Pattern Mapping
- Command Message maps to task invocation or command handlers.
- Event Message maps to brokered event handlers.
- Polling Consumer and Event-Driven Consumer map to worker behavior depending on broker.
- Idempotent Receiver maps to durable task or business-key deduplication.
- Message Expiration maps to time limits, TTLs, and stale-task handling.

## Implementation Notes
- Use dataclasses, Pydantic models, or schema validators for payload contracts.
- Keep task functions thin and delegate domain behavior to testable modules.
- Bound retries and define terminal failure routing before enabling broad retry.
- Make idempotency keys explicit in task arguments or message headers.

## Testing Guidance
- Test task behavior with duplicate and malformed fixtures.
- Add contract tests for serialized payload versions.
- Exercise retry exhaustion, expiration, and recovery paths.

## Operational Guidance
- Track queue depth, task age, retry count, failures, and handler duration.
- Include correlation IDs in task metadata and logs.
- Keep replay procedures privacy-aware and auditable.
