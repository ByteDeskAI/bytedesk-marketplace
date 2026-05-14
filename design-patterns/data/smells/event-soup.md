---
slug: event-soup
name: Event Soup
domain: integration-smell
category: Architecture Smells
groups:
  - architecture-smell
patterns:
  - event-message
  - message-router
  - message-history
  - correlation-identifier
references:
  - skills/integration-flow-review/references/implementation.md
  - skills/architecture-decision/references/implementation.md
---

# Event Soup

## Symptom
Many events circulate without clear ownership, naming discipline, contract governance, or traceable consumer responsibility.

## Why It Matters
The system appears decoupled but becomes hard to reason about, test, replay, or support. Producers and consumers evolve by guesswork.

## Pattern Responses
- Use Event Message with clear business facts.
- Use Message Router only for explicit routing rules.
- Use Correlation Identifier and Message History for traceability.

## False Positives
A high event count is not a smell when contracts, ownership, and observability are strong.

## Checks
- Can each event owner explain who consumes it and why?
- Are event names facts rather than commands?
- Can support trace one business event through consumers?
