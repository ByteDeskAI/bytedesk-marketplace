# Examples

## Event Fanout Decision

Prompt: "Should order creation notify billing, fulfillment, and analytics through direct calls or events?"

Response shape:

- Decision summary: use Event Message over a Publish-Subscribe Channel for downstream notifications.
- Context and forces: producer autonomy, independent scaling, at-least-once delivery, and support visibility.
- Options considered: publish-subscribe events, direct synchronous calls, request-reply broker flow.
- Tradeoff matrix: direct calls are simpler but couple availability; events improve autonomy but require idempotency and observability.
- Recommended pattern set: Event Message, Publish-Subscribe Channel, Durable Subscriber, Idempotent Receiver, Correlation Identifier, Dead Letter Channel.
- Consequences: consumers own retries and deduplication; publisher owns event contract; operations owns dead-letter replay.
- Verification plan: duplicate delivery test, consumer outage replay test, trace correlation check, dead-letter alert.

## Strategy Refactor Decision

Prompt: "Our pricing service has conditionals by customer type. Is Strategy the right move?"

Response shape:

- Decision summary: use Strategy only if pricing rules vary independently and need runtime selection.
- Context and forces: branch growth, test isolation, domain ownership, configuration needs.
- Options considered: Strategy, table-driven rules, keep conditionals.
- Tradeoff matrix: Strategy improves rule isolation but can fragment domain logic; table-driven rules work when behavior is data-heavy.
- Recommended pattern set: Strategy with domain-specific names, not generic `ConcreteStrategy`.
- Consequences: pricing service delegates algorithm choice; tests move to behavior-focused pricing examples.
- Verification plan: golden pricing cases, branch parity tests, configuration selection tests.

## No-Pattern Decision

Prompt: "Should we introduce Abstract Factory for two report types?"

Response shape:

- Decision summary: do not introduce Abstract Factory yet.
- Context and forces: only two simple products, construction is local, no product-family compatibility rule.
- Options considered: direct constructors, factory function, Abstract Factory.
- Tradeoff matrix: Abstract Factory adds indirection before the family boundary exists.
- Recommended pattern set: no pattern yet; use a small named factory function if construction duplication appears.
- Consequences: lower ceremony and easier deletion.
- Verification plan: keep tests at report output behavior, revisit if products multiply or family consistency emerges.
