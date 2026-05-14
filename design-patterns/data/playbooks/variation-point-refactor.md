---
slug: variation-point-refactor
name: Variation Point Refactor
domain: object-playbook
category: Object Design Playbooks
groups:
  - architecture-playbook
patterns:
  - strategy
  - factory-method
  - template-method
  - decorator
smells:
  - conditional-sprawl
  - pattern-ceremony
references:
  - skills/architecture-decision/references/implementation.md
  - skills/pattern-application/references/implementation.md
---

# Variation Point Refactor

## Intent
Extract a recurring behavior or construction variation without turning simple code into generic pattern machinery.

## When To Use
- Conditionals choose algorithms, construction paths, or optional behavior.
- Variants change independently and need focused tests.
- The variation boundary has a domain name.

## Avoid When
- There are only one or two trivial branches.
- A function parameter, map, enum, or framework hook is clearer.
- The proposed abstraction would need too much host object state.

## Pattern Set
- Strategy for interchangeable behavior.
- Factory Method for construction variation.
- Template Method for invariant algorithm order.
- Decorator for optional cross-cutting behavior.

## Implementation Steps
1. Add tests around the existing behavior.
2. Extract one domain-named variation at a time.
3. Keep callers stable while moving branch logic.
4. Delete old branches only after parity is proven.

## Verification
- Variant tests are independent and behavior-focused.
- Callers use domain concepts rather than pattern role names.
- The refactor removes conditionals instead of adding another layer beside them.
