# Integration Flow Review Implementation Guidance

## Baseline Hardening

Every non-trivial flow should answer:

- What is the delivery guarantee?
- What happens on duplicate delivery?
- What is the correlation key?
- What is the retry limit?
- Where do permanently failed messages go?
- How does support inspect and replay?
- How are schema versions identified?

## Pattern Families

- Message construction: command, document, event, request-reply, sequence.
- Channels: point-to-point, publish-subscribe, datatype, invalid, dead-letter, bridge.
- Routing: content-based router, recipient list, splitter, aggregator, resequencer, process manager.
- Transformation: translator, normalizer, enricher, filter, claim check, canonical data model.
- Endpoints: gateway, mapper, polling consumer, event-driven consumer, competing consumers, idempotent receiver.
- Operations: control bus, wire tap, message history, message store, smart proxy, test message.

## Failure Modes

- Duplicate processing creates side effects.
- Late messages violate business windows.
- Missing sequence chunks block aggregation.
- Dynamic routes become stale or unauthorized.
- Dead-letter queues accumulate without ownership.
- Wire taps leak sensitive payloads.
- Claim checks point to expired or inaccessible data.

