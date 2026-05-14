# Integration Flow Review Usage

Use this reference when reviewing or designing asynchronous, message-driven, event-driven, queue-based, stream-based, or brokered integration flows.

## Invocation Modes

- Flow design: select a minimal integration pattern set.
- Flow review: find gaps in routing, delivery, idempotency, ordering, and operations.
- Consumer hardening: make endpoint behavior safe under retry and duplicate delivery.
- Message contract review: assess payload shape, versioning, and correlation.
- Operations review: add visibility, replay, dead-letter, and support hooks.

## Input Expectations

Map these before recommending:

- producers and consumers;
- message names and payload shape;
- channel or broker type;
- delivery semantics;
- retry and timeout policy;
- ordering requirements;
- idempotency key;
- observability and support workflow.

## Output Contract

1. Flow summary in user terms.
2. Recommended pattern set.
3. Failure-mode checklist.
4. Concrete implementation notes for the stack.
5. Observability and operations hooks.

Prefer a small coherent set rather than a catalog tour.

For every material flow, include delivery semantics, duplicate handling, ordering expectation, retry and terminal-failure behavior, correlation strategy, replay or support workflow, and privacy-sensitive payload concerns. If any of those are unknown, call them out as open decisions instead of silently assuming defaults.
