---
slug: event-fanout
name: Event Fanout
domain: integration-playbook
category: Integration Playbooks
groups:
  - architecture-playbook
patterns:
  - event-message
  - publish-subscribe-channel
  - durable-subscriber
  - idempotent-receiver
  - correlation-identifier
smells:
  - event-soup
  - naive-exactly-once
references:
  - skills/architecture-decision/references/implementation.md
  - skills/integration-flow-review/references/implementation.md
---

# Event Fanout

## Intent
Notify multiple independent consumers that a business fact happened without coupling the producer to each recipient.

## When To Use
- A producer should not know every downstream recipient.
- Consumers can process independently and tolerate at-least-once delivery.
- Operational support can trace, replay, and dead-letter failed work.

## Avoid When
- The producer needs an immediate answer from every recipient.
- Consumers require strict global ordering across all events.
- Event contracts and ownership are not governed.

## Pattern Set
- Event Message for the fact being published.
- Publish-Subscribe Channel for fanout.
- Durable Subscriber for consumers that must not miss events.
- Idempotent Receiver for duplicate delivery.
- Correlation Identifier and Dead Letter Channel for support.

## Implementation Steps
1. Define the event as a past-tense business fact.
2. Assign event contract ownership and versioning rules.
3. Add consumer idempotency before broad fanout.
4. Add correlation, dead-letter triage, and replay workflow.

## Verification
- Duplicate event delivery does not repeat unsafe side effects.
- A consumer outage can recover from retained events.
- Dead-lettered messages are visible, owned, and replayable.
