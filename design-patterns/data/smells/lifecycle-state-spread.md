---
slug: lifecycle-state-spread
name: Lifecycle State Spread
domain: object-smell
category: Architecture Smells
groups:
  - architecture-smell
patterns:
  - state
  - command
  - memento
references:
  - skills/pattern-finder/references/implementation.md
  - skills/architecture-issue-scan/references/implementation.md
---

# Lifecycle State Spread

## Symptom
State checks and transition rules are scattered across services, controllers, handlers, or UI logic.

## Why It Matters
Illegal transitions and inconsistent behavior appear because no boundary owns lifecycle rules.

## Pattern Responses
- Use State when behavior differs by lifecycle state.
- Use Command for explicit transition requests.
- Use Memento for recoverable snapshots when rollback matters.

## False Positives
Simple status validation can remain a guard clause or table constraint.

## Checks
- Does the same status transition appear in several places?
- Are illegal transitions consistently rejected?
- Are state-specific tests easy to write?
