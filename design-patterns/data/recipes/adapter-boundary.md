---
slug: adapter-boundary
name: Adapter Boundary
domain: boundary-recipe
category: Pattern Application Recipes
groups:
  - pattern-recipe
patterns:
  - adapter
  - facade
smells:
  - fragile-adapter
  - anemic-facade
references:
  - skills/pattern-application/references/implementation.md
  - skills/architecture-decision/references/implementation.md
---

# Adapter Boundary

## Goal
Stop external SDK, protocol, or legacy concepts from leaking into domain code.

## Preconditions
- A dependency exposes concepts or errors that do not belong in the domain.
- The boundary has a clear domain responsibility.
- Representative external behavior can be tested or simulated.

## Steps
1. Name the boundary by domain capability.
2. Define domain-owned input and output types.
3. Move SDK calls, protocol mapping, timeout handling, and error translation into the adapter.
4. Update callers to use the domain boundary only.
5. Add contract tests for representative external behavior.

## Tests
- Success, timeout, error, and malformed-response tests.
- Contract fixtures for payload mapping.
- Caller tests that no longer import external SDK types.

## Rollback
- Keep the old direct dependency path behind a feature flag or isolated wrapper until parity is proven.
