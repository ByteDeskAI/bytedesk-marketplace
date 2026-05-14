---
slug: stateful-workflow-recipe
name: Stateful Workflow Recipe
domain: object-recipe
category: Pattern Application Recipes
groups:
  - pattern-recipe
patterns:
  - state
  - command
  - memento
smells:
  - lifecycle-state-spread
references:
  - skills/pattern-application/references/implementation.md
  - skills/architecture-decision/references/implementation.md
---

# Stateful Workflow Recipe

## Goal
Make lifecycle-dependent behavior and legal transitions explicit.

## Preconditions
- State-specific behavior is scattered or duplicated.
- Legal transitions are known or can be discovered.
- Current behavior can be captured in transition tests.

## Steps
1. List states, events, commands, and legal transitions.
2. Add parity tests for current transition behavior.
3. Move state-specific behavior into domain-named state handlers or transition functions.
4. Add explicit failure behavior for illegal transitions.
5. Add audit or snapshot support only when recovery needs it.

## Tests
- Legal transitions succeed with expected side effects.
- Illegal transitions fail consistently.
- State-specific behavior is covered without relying on broad service tests.

## Rollback
- Keep transition routing behind the old service boundary until parity and audit checks pass.
