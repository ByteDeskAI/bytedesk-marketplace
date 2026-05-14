---
slug: fragile-adapter
name: Fragile Adapter
domain: boundary-smell
category: Architecture Smells
groups:
  - architecture-smell
patterns:
  - adapter
  - messaging-gateway
  - channel-adapter
  - canonical-data-model
references:
  - skills/pattern-application/references/implementation.md
  - skills/architecture-issue-scan/references/implementation.md
---

# Fragile Adapter

## Symptom
An adapter hides a dependency name but leaks payload shape, protocol quirks, exceptions, or retry behavior.

## Why It Matters
Callers still carry integration knowledge, and changes in the external system ripple through the domain.

## Pattern Responses
- Use Adapter to translate concepts, not just method names.
- Use Messaging Gateway or Channel Adapter for transport boundaries.
- Use Canonical Data Model only when many integrations need a stable shared shape.

## False Positives
Early migration wrappers may be intentionally thin while behavior is being characterized.

## Checks
- Are external exceptions visible outside the adapter?
- Do domain objects contain transport or SDK fields?
- Are retries, timeouts, and mapping rules tested at the boundary?
