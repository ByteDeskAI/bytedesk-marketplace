---
slug: python
displayName: Python
---

# Python

## Object Design Idioms
- Use duck typing, protocols, decorators, context managers, dataclasses, and functions before porting class diagrams.
- Strategy, Command, Adapter, and Decorator are often simple callables or wrapper objects.
- Reserve formal factories for plugin loading, external resources, or complicated construction policies.

## Integration Stacks
- Celery
- Dramatiq
- Faust
- FastStream
- aio-pika
- Kafka

## Implementation Notes
- Use functions, protocols, decorators, context managers, dataclasses, and small modules before introducing formal class hierarchies.
- For Celery, Dramatiq, FastStream, aio-pika, or Kafka flows, make task identity, retry limits, idempotency keys, and serialization explicit.
- Keep adapters thin but meaningful: translate external exceptions, payloads, and timeouts into domain terms.

## Testing Guidance
- Use pytest fixtures for behavior variants, contract fixtures for payloads, and broker-backed tests only where delivery semantics matter.
- Test retry and duplicate handling around side-effect boundaries.

## Operational Guidance
- Include correlation IDs in task headers and logs, bound retries, and route exhausted work to visible recovery paths.
- Watch queue depth, task age, handler duration, and dead-letter or failed-task counts.
