---
slug: idempotent-receiver-recipe
name: Idempotent Receiver Recipe
domain: integration-recipe
category: Pattern Application Recipes
groups:
  - pattern-recipe
patterns:
  - idempotent-receiver
  - guaranteed-delivery
smells:
  - naive-exactly-once
references:
  - skills/pattern-application/references/implementation.md
  - skills/integration-flow-review/references/implementation.md
---

# Idempotent Receiver Recipe

## Goal
Make a message handler safe under retry, redelivery, and replay.

## Preconditions
- A stable message identity or business key exists.
- Side effects can be guarded or made conditional.
- Deduplication state has a retention policy.

## Steps
1. Choose the idempotency key and retention window.
2. Persist processing state before or atomically with unsafe side effects.
3. Return safely when the same key is seen again.
4. Record enough metadata for support and replay decisions.
5. Pair retry policy with dead-letter behavior.

## Tests
- Duplicate delivery does not repeat side effects.
- Crash or partial-failure scenario is safe.
- Replay after failure is bounded and observable.

## Rollback
- Disable broad replay or retry expansion until idempotency metrics show stable behavior.
