---
slug: message-replay-and-recovery
name: Message Replay And Recovery
domain: operations-playbook
category: Operations Playbooks
groups:
  - architecture-playbook
patterns:
  - message-store
  - dead-letter-channel
  - idempotent-receiver
  - message-history
  - control-bus
smells:
  - unbounded-retry
  - naive-exactly-once
references:
  - skills/architecture-decision/references/implementation.md
  - skills/integration-flow-review/references/implementation.md
---

# Message Replay And Recovery

## Intent
Make failed or delayed message processing recoverable without corrupting downstream state.

## When To Use
- Failures need inspection, correction, or replay.
- Consumer side effects must tolerate redelivery.
- Support teams need bounded operational controls.

## Avoid When
- Payload retention violates privacy or cost constraints.
- Replaying messages can repeat unsafe side effects.
- No owner is available for dead-letter triage.

## Pattern Set
- Message Store for audit or replay material.
- Dead Letter Channel for terminal failures.
- Idempotent Receiver for safe replay.
- Message History and Control Bus for operational visibility.

## Implementation Steps
1. Define retention, privacy, and access-control policy.
2. Add idempotency before replay controls.
3. Separate invalid messages from processing failures.
4. Document replay authorization and audit trail.

## Verification
- Replay is bounded, audited, and idempotent.
- Failed messages route to an owned terminal path.
- Support can inspect metadata without exposing sensitive payloads unnecessarily.
