---
slug: document-message
name: Document Message
domain: message-construction
category: Message Construction
groups:
  - integration-design
languages:
  - csharp
  - java
  - typescript
  - python
  - go
  - rust
  - cpp
qualityAttributes:
  - reliability
  - operability
  - decoupling
implementationComplexity: medium
operationalRisk: medium
tradeoffs:
  - Adds explicit structure and vocabulary for the force.
  - Can become ceremony when the force is small or temporary.
  - Requires tests that prove the new boundary preserves behavior.
failureModes:
  - Pattern name becomes more important than the problem force.
  - Ownership and lifecycle rules remain implicit.
  - The implementation hides simpler language or framework idioms.
testingFocus:
  - Behavior parity at the public boundary.
  - Variant or flow-specific edge cases.
  - Regression checks for the force the pattern addresses.
observabilityFocus:
  - Decision points that affect runtime behavior.
  - Failure paths introduced by the new boundary.
  - Signals useful for support and rollback.
related:
  - event-message
  - claim-check
  - message-translator
relationships:
  - companion:event-message
  - companion:claim-check
  - companion:message-translator
references:
  - skills/architecture-decision/references/implementation.md
  - skills/pattern-advisor/references/implementation.md
  - skills/pattern-finder/references/implementation.md
  - skills/pattern-application/references/implementation.md
  - skills/architecture-issue-scan/references/implementation.md
  - skills/integration-flow-review/references/implementation.md
---

# Document Message

## Intent
Transfer a document-like data structure for another system to consume.

## When To Use
- The receiver decides what to do with the data.
- The payload is a business document, snapshot, or data transfer.
- The message should not imply a specific action.

## Avoid When
- The producer needs the receiver to execute a command.
- Payload size exceeds broker or retention limits.
- Document versioning is unmanaged.

## Forces
- Keep producers and consumers independently changeable while preserving message contract clarity.
- Make delivery, retry, ordering, and failure behavior explicit instead of accidental.
- Balance autonomy with supportability, traceability, and operational ownership.

## Tradeoffs
- Improves decoupling and operational control, but adds broker, schema, and support-policy responsibilities.
- Makes flow behavior easier to observe centrally, but can hide domain decisions if routing or transformation rules drift away from owners.
- Works best when teams agree on message identity, versioning, replay, and terminal failure policy.

## Failure Modes
- Treating the pattern as infrastructure only and skipping ownership, idempotency, or dead-letter decisions.
- Allowing message contracts to change without compatibility tests or versioning signals.
- Adding retries, fanout, or routing without correlation, replay, and support visibility.

## Testing
- Cover happy path, duplicate delivery, poison message, timeout, and replay behavior at the flow boundary.
- Test message contracts with representative payloads and explicit version or format expectations.
- Verify that operational handling is bounded: retries stop, failures surface, and recovery is documented.

## Observability
- Emit correlation identifiers, route decisions, retry attempts, terminal failures, and replay actions.
- Track queue depth, age, consumer lag, dead-letter count, and handler latency where applicable.
- Keep payload visibility privacy-aware by logging identifiers and metadata before full message bodies.

## Implementation Notes
- Start with the smallest channel, message, endpoint, and operations set that resolves the force.
- Define ownership for message contracts, retry limits, dead-letter triage, and replay before scaling consumers.
- Prefer framework primitives that make Document Message explicit without hiding business rules inside generic plumbing.
