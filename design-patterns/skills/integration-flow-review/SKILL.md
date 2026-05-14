---
name: integration-flow-review
description: Review message-driven, event-driven, async workflow, broker, queue, stream, saga, or integration architecture.
when_to_use: Use when designing, reviewing, or hardening integration flows, including channels, messages, routing, transformation, endpoint behavior, retries, idempotency, ordering, correlation, observability, and operations.
argument-hint: "[flow-or-system]"
user-invocable: true
disable-model-invocation: false
allowed-tools: Read Grep Glob Bash(patterns *)
model: inherit
---

# Integration Flow Review

Use this skill for message-driven, event-driven, brokered, queue-based, stream-based, and integration architecture.

## References

- For invocation modes and flow review expectations, read [references/usages.md](references/usages.md).
- For common flow examples and response shapes, read [references/examples.md](references/examples.md).
- For hardening checklists and failure modes, read [references/implementation.md](references/implementation.md).
- For catalog lookup commands and companion patterns, read [references/catalog.md](references/catalog.md).

Start by mapping the flow:

- Producers, consumers, and ownership boundaries.
- Message type: command, document, event, request-reply, or sequence.
- Channel type: point-to-point, publish-subscribe, datatype, invalid, dead-letter, or bridge.
- Routing and transformation: filters, content-based routers, recipient lists, splitters, aggregators, normalizers, translators, or claim checks.
- Endpoint behavior: polling, event-driven, competing consumers, selective consumers, idempotent receivers, or service activators.
- Operations: correlation identifiers, message history, wire taps, message stores, test messages, and purging.

Review forces:

- Delivery semantics and duplicate handling.
- Ordering, partitioning, and resequencing.
- Backpressure, retries, timeouts, and terminal failure.
- Payload size, schema versioning, and privacy.
- Observability, audit, replay, and support tooling.
- Consumer autonomy and producer coupling.

Consult pattern memory first: run `patterns memory recall --query "<flow or force>"`. If a prior ADR decision already covers this integration force, surface it before recommending a fresh pattern set.

Lookup workflow:

1. Use `patterns list integration-design` to survey integration-oriented patterns.
2. Use `patterns playbooks` for common integration pattern sets.
3. Use `patterns smells` to check whether the flow has known risks.
4. Use `patterns show <slug>` for candidate pattern entries.
5. Use `patterns languages <language>` for ecosystem-specific implementation options.

Output should include:

1. Flow summary in the user's terms.
2. Recommended integration pattern set.
3. Failure-mode checklist.
4. Concrete implementation sketch for the user's stack.
5. Observability and operations hooks.

Prefer a small pattern set. Most flows need a channel, a message construction choice, one routing or transformation choice, one endpoint pattern, and explicit operations patterns.
