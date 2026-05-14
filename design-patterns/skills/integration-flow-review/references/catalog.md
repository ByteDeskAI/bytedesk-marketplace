# Integration Flow Review Catalog Use

## Lookup Commands

```bash
patterns list integration-design
patterns list message-routing
patterns list message-transformation
patterns list message-endpoint
patterns list operations-and-observability
patterns recommend "producer should not know every downstream recipient"
patterns playbooks event-fanout
patterns smells event-soup
patterns frameworks go-watermill-nats
patterns recipes dead-letter-channel-recipe
patterns graph --query "what mitigates unbounded retry"
patterns context ./src --query "consumer redelivers failed messages" --language go
patterns snippets idempotent-receiver --language python
patterns show content-based-router
patterns show idempotent-receiver
```

## Flow Mapping

- Start with message construction.
- Choose the channel pattern.
- Add one routing or transformation pattern only if needed.
- Add endpoint behavior patterns.
- Add operations patterns for visibility and recovery.

## Companion Patterns

- `event-message` usually pairs with `publish-subscribe-channel`.
- `request-reply` usually needs `return-address` and `correlation-identifier`.
- `splitter` often needs `aggregator` or `message-sequence`.
- `guaranteed-delivery` needs `idempotent-receiver`.
- `dead-letter-channel` needs ownership, alerting, and replay policy.
- `patterns context` is the fastest path when code evidence, scan findings, snippets, and ADR-ready guidance should be returned together.
