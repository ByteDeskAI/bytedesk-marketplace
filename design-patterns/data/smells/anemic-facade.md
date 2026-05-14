---
slug: anemic-facade
name: Anemic Facade
domain: boundary-smell
category: Architecture Smells
groups:
  - architecture-smell
patterns:
  - facade
  - adapter
  - bridge
references:
  - skills/architecture-issue-scan/references/implementation.md
  - skills/architecture-decision/references/implementation.md
---

# Anemic Facade

## Symptom
A facade merely forwards calls while leaking subsystem concepts, errors, configuration, and lifecycle rules to callers.

## Why It Matters
The apparent boundary does not reduce coupling. Callers still depend on the subsystem's shape and must change when the subsystem changes.

## Pattern Responses
- Strengthen Facade when the boundary should simplify a subsystem.
- Use Adapter when the real force is interface mismatch.
- Use Bridge when multiple implementations vary independently.

## False Positives
A thin wrapper can be acceptable during migration if it is deliberately temporary and tested.

## Checks
- Do callers import subsystem types?
- Are error, retry, or lifecycle rules duplicated outside the boundary?
- Would replacing the subsystem require widespread caller changes?
