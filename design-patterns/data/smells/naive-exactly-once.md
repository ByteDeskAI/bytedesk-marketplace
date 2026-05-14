---
slug: naive-exactly-once
name: Naive Exactly Once
domain: integration-smell
category: Architecture Smells
groups:
  - architecture-smell
patterns:
  - idempotent-receiver
  - guaranteed-delivery
  - transactional-client
  - dead-letter-channel
references:
  - skills/integration-flow-review/references/implementation.md
  - skills/architecture-decision/references/implementation.md
---

# Naive Exactly Once

## Symptom
The design assumes messages, commands, or jobs execute exactly once without durable idempotency, transaction boundaries, or recovery policy.

## Why It Matters
Retries, broker redelivery, process crashes, and partial side effects can duplicate or lose business operations.

## Pattern Responses
- Use Idempotent Receiver for duplicate-safe handling.
- Use Guaranteed Delivery for persisted delivery attempts.
- Use Transactional Client when send/receive and state changes need atomicity.
- Use Dead Letter Channel for exhausted failures.

## False Positives
Exactly-once-like guarantees may be acceptable inside a single transactional database boundary.

## Checks
- What happens after a crash between side effect and ack?
- Is there a stable idempotency key?
- Can failed messages stop retrying and be recovered?
