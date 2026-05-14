# ADR: Use Event Fanout For OrderCreated Notifications

## Decision
Use Event Message over a Publish-Subscribe Channel so billing, fulfillment, and analytics can consume OrderCreated independently.

## Alternatives Considered
- Direct synchronous calls: simpler to trace but couples order creation to downstream availability.
- Request-reply workflow: useful only if order creation needs an immediate answer from each recipient.
- No pattern yet: not enough because consumers can be down and redelivery is expected.

## Consequences
- Consumers own idempotency and retry behavior.
- The publisher owns the event contract and versioning.
- Operations owns dead-letter triage, replay, and support visibility.

## Verification
- Duplicate delivery does not repeat unsafe side effects through Idempotent Receiver.
- A consumer outage can recover with Durable Subscriber behavior.
- Correlation Identifier appears in logs and traces.
- Dead Letter Channel has owner, alert, and replay procedure.
