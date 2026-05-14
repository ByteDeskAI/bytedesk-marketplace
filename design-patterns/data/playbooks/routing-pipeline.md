---
slug: routing-pipeline
name: Routing Pipeline
domain: integration-playbook
category: Integration Playbooks
groups:
  - architecture-playbook
patterns:
  - pipes-and-filters
  - content-based-router
  - message-filter
  - recipient-list
  - wire-tap
smells:
  - hidden-router
  - event-soup
references:
  - skills/architecture-decision/references/implementation.md
  - skills/integration-flow-review/references/implementation.md
---

# Routing Pipeline

## Intent
Centralize routing and filtering decisions while keeping producers free from destination knowledge.

## When To Use
- Routing rules are duplicated across producers.
- Message eligibility and destination logic need tests and visibility.
- A pipeline can expose decisions without owning domain policy.

## Avoid When
- Routing rules are really domain decisions that belong upstream.
- Payload inspection creates privacy or performance risk.
- Operators cannot reason about route changes.

## Pattern Set
- Pipes and Filters for staged processing.
- Content-Based Router for destination selection.
- Message Filter for discard or quarantine decisions.
- Recipient List for multi-destination delivery.
- Wire Tap for route visibility.

## Implementation Steps
1. Separate domain eligibility from transport routing.
2. Make route rules versioned, tested, and observable.
3. Keep payload inspection narrow and privacy-aware.
4. Add route-decision logging before changing destinations.

## Verification
- Route rules have deterministic tests.
- Producers do not know downstream destinations.
- Route changes produce auditable decision signals.
