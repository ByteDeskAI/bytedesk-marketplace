---
slug: message-router
name: Message Router
domain: messaging-system
category: Messaging Systems
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
  - content-based-router
  - recipient-list
  - dynamic-router
relationships:
  - often-confused-with:content-based-router
  - companion:recipient-list
  - often-confused-with:dynamic-router
references:
  - skills/architecture-decision/references/implementation.md
  - skills/pattern-advisor/references/implementation.md
  - skills/pattern-finder/references/implementation.md
  - skills/pattern-application/references/implementation.md
  - skills/architecture-issue-scan/references/implementation.md
  - skills/integration-flow-review/references/implementation.md
---

# Message Router

## Intent
Route a message to one or more destinations based on routing logic.

## When To Use
- Senders should not know all possible recipients.
- Routing criteria may change independently of producers.
- Central routing improves control and observability.

## Avoid When
- Routing rules become opaque business logic.
- A direct subscription model is enough.
- The router is a bottleneck or single point of failure.

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
- Prefer framework primitives that make Message Router explicit without hiding business rules inside generic plumbing.
