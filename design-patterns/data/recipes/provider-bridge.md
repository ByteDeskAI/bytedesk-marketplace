---
slug: provider-bridge
name: Provider Bridge
domain: boundary-recipe
category: Pattern Application Recipes
groups:
  - pattern-recipe
patterns:
  - bridge
  - strategy
  - adapter
smells:
  - provider-switch-sprawl
references:
  - skills/pattern-application/references/implementation.md
  - skills/architecture-decision/references/implementation.md
---

# Provider Bridge

## Goal
Separate provider selection and provider-specific SDK behavior from domain workflows.

## Preconditions
- More than one provider, engine, tenant mode, or runtime implementation exists or is imminent.
- Provider-specific payloads or errors currently leak into callers.
- Compatibility can be tested per provider.

## Steps
1. Define the domain abstraction and provider capability matrix.
2. Put each provider SDK behind an adapter.
3. Move provider selection into composition or policy code.
4. Add contract tests for each provider implementation.
5. Trace provider selection and provider-specific failures.

## Tests
- Adding a provider does not change domain workflows.
- Provider errors map consistently.
- Selection policy is deterministic and observable.

## Rollback
- Keep the existing provider path as the default until the new bridge passes compatibility tests.
