---
slug: conditional-sprawl
name: Conditional Sprawl
domain: object-smell
category: Architecture Smells
groups:
  - architecture-smell
patterns:
  - strategy
  - state
  - command
  - factory-method
references:
  - skills/pattern-finder/references/implementation.md
  - skills/architecture-issue-scan/references/implementation.md
---

# Conditional Sprawl

## Symptom
Repeated branches choose behavior, type construction, lifecycle state, or command handling across multiple modules.

## Why It Matters
Adding a variant requires edits in many places, and tests usually cover branches indirectly rather than behavior boundaries.

## Pattern Responses
- Use Strategy for interchangeable algorithms.
- Use State for lifecycle-dependent behavior.
- Use Command for explicit actions.
- Use Factory Method for construction variation.

## False Positives
Small local conditionals can be clearer than a new abstraction.

## Checks
- Does the same condition appear in several files?
- Is a new variant likely?
- Can each branch be named as a domain behavior?
