---
slug: dead-letter-channel-recipe
name: Dead Letter Channel Recipe
domain: integration-recipe
category: Pattern Application Recipes
groups:
  - pattern-recipe
patterns:
  - dead-letter-channel
  - invalid-message-channel
  - message-expiration
smells:
  - unbounded-retry
references:
  - skills/pattern-application/references/implementation.md
  - skills/integration-flow-review/references/implementation.md
---

# Dead Letter Channel Recipe

## Goal
Give exhausted or permanently failed messages an owned, observable terminal path.

## Preconditions
- Retry limits or expiration rules can be defined.
- An owner can triage failed messages.
- Replay or discard decisions can be audited.

## Steps
1. Separate invalid messages from processing failures where useful.
2. Define retry count, backoff, expiration, and terminal routing.
3. Add failure metadata: reason, correlation ID, handler, and first failure time.
4. Create alerting and dashboard ownership.
5. Document replay, correction, and discard procedures.

## Tests
- Poison messages stop retrying.
- Terminal failures are visible and owned.
- Replay is permissioned, bounded, and idempotent.

## Rollback
- Keep failure routing dark-launched until operators can inspect and replay safely.
