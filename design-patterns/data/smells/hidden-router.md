---
slug: hidden-router
name: Hidden Router
domain: integration-smell
category: Architecture Smells
groups:
  - architecture-smell
patterns:
  - message-router
  - content-based-router
  - recipient-list
  - routing-slip
references:
  - skills/integration-flow-review/references/implementation.md
  - skills/pattern-finder/references/implementation.md
---

# Hidden Router

## Symptom
Routing decisions are scattered across producers, consumers, configuration, and conditionals with no single testable policy.

## Why It Matters
Flow behavior changes accidentally. Producers learn too much about destinations, and operations cannot explain why a message went somewhere.

## Pattern Responses
- Use Message Router to centralize routing responsibility.
- Use Content-Based Router when payload or header data drives routing.
- Use Recipient List for explicit multi-recipient routing.
- Use Routing Slip when the route is attached to the message.

## False Positives
Static broker bindings can be enough when routes are simple, owned, and visible.

## Checks
- Can a test explain every route for representative messages?
- Do producers know consumer names?
- Are route changes observable and reviewable?
