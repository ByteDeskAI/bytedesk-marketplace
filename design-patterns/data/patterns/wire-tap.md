---
slug: wire-tap
name: Wire Tap
domain: operations-and-observability
category: System Management
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
  - message-history
  - message-store
  - detour
relationships:
  - companion:message-history
  - companion:message-store
  - companion:detour
references:
  - skills/architecture-decision/references/implementation.md
  - skills/pattern-advisor/references/implementation.md
  - skills/pattern-finder/references/implementation.md
  - skills/pattern-application/references/implementation.md
  - skills/architecture-issue-scan/references/implementation.md
  - skills/integration-flow-review/references/implementation.md
---

# Wire Tap

## Intent
Copy messages from a channel for monitoring, audit, or diagnostics without disturbing the main flow.

## When To Use
- Operators need visibility into live traffic.
- Copies can be secured, sampled, and retained appropriately.
- The main path must remain unaffected.

## Avoid When
- Taps expose sensitive payloads without controls.
- Diagnostics add meaningful latency or backpressure.
- Copied data is mistaken for authoritative processing.

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
- Prefer framework primitives that make Wire Tap explicit without hiding business rules inside generic plumbing.
