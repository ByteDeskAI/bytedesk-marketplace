---
slug: pattern-ceremony
name: Pattern Ceremony
domain: design-smell
category: Architecture Smells
groups:
  - architecture-smell
patterns:
  - strategy
  - abstract-factory
  - mediator
  - visitor
references:
  - skills/pattern-advisor/references/implementation.md
  - skills/architecture-decision/references/implementation.md
---

# Pattern Ceremony

## Symptom
Pattern-shaped classes, interfaces, or layers exist before the design has enough variation, ownership pressure, or runtime risk to justify them.

## Why It Matters
The code becomes harder to read, change, and delete while providing little isolation or operational benefit.

## Pattern Responses
- Prefer a no-pattern recommendation when simple language features are clearer.
- Use Strategy, Factory, Mediator, or Visitor only when the force is recurring and testable.
- Keep production names domain-specific rather than pattern-role-specific.

## False Positives
Some frameworks require structure that resembles patterns; judge by whether it reduces real risk.

## Checks
- Can the abstraction be deleted without changing behavior?
- Are there real variants or only hypothetical ones?
- Do tests exercise behavior or just construction?
