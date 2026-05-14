---
slug: unbounded-retry
name: Unbounded Retry
domain: integration-smell
category: Architecture Smells
groups:
  - architecture-smell
patterns:
  - dead-letter-channel
  - message-expiration
  - idempotent-receiver
  - control-bus
references:
  - skills/integration-flow-review/references/implementation.md
  - skills/architecture-issue-scan/references/implementation.md
---

# Unbounded Retry

## Symptom
Failed work retries indefinitely or with unclear terminal behavior, often without idempotency or operator visibility.

## Why It Matters
Retry storms, duplicate side effects, stale work, and hidden poison messages can damage reliability.

## Pattern Responses
- Use Dead Letter Channel for terminal failures.
- Use Message Expiration for stale work.
- Use Idempotent Receiver before retrying side-effecting handlers.
- Use Control Bus for bounded operational control.

## False Positives
Short automatic retries can be acceptable for transient faults when side effects are safe and limits are explicit.

## Checks
- What is the maximum retry count or time window?
- Where does failed work go?
- Can operators see and safely recover exhausted failures?
