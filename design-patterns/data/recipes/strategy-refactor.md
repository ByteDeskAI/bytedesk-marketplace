---
slug: strategy-refactor
name: Strategy Refactor
domain: object-recipe
category: Pattern Application Recipes
groups:
  - pattern-recipe
patterns:
  - strategy
smells:
  - conditional-sprawl
references:
  - skills/pattern-application/references/implementation.md
  - skills/architecture-decision/references/implementation.md
---

# Strategy Refactor

## Goal
Move repeated algorithm-selection branches behind a domain-named behavior boundary.

## Preconditions
- Branches share the same input and output shape.
- Each branch can be named as a domain behavior.
- Existing behavior can be covered with parity tests.

## Steps
1. Add behavior tests around the current public boundary.
2. Extract one branch into a domain-named callable or implementation.
3. Introduce a narrow selection point near composition or configuration.
4. Move remaining branches one at a time.
5. Delete the old conditional only after parity is proven.

## Tests
- Golden behavior tests for each variant.
- Selection tests for runtime or configuration-driven choice.
- Regression tests for the previous default behavior.

## Rollback
- Keep the old conditional path available until every variant has parity coverage.
