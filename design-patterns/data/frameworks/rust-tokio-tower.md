---
slug: rust-tokio-tower
name: Rust / Tokio + Tower
domain: framework-pack
category: Framework Implementation Packs
groups:
  - framework-implementation
languages:
  - rust
patterns:
  - strategy
  - state
  - adapter
  - pipes-and-filters
  - idempotent-receiver
  - message-history
references:
  - skills/architecture-decision/references/implementation.md
  - skills/pattern-application/references/implementation.md
---

# Rust / Tokio + Tower

## Best For
- Async Rust services with explicit ownership, backpressure, middleware, and protocol boundaries.
- Systems that need compile-time guarantees for state and behavior variation.
- Teams using Tower layers or services for cross-cutting behavior.

## Pattern Mapping
- Strategy maps to generics or trait objects depending on runtime selection needs.
- State maps to enums, typestate, or explicit transition structs.
- Adapter maps to protocol, SDK, or transport boundary modules.
- Pipes and Filters map to Tower layers or staged async processing.
- Idempotent Receiver is explicit durable state around side effects.

## Implementation Notes
- Prefer enums and traits before runtime polymorphism.
- Keep cancellation, timeout, retry, and backpressure visible in function signatures or service layers.
- Avoid global mutable state; pass dependencies explicitly or use carefully scoped shared state.
- Use adapters to translate external errors into domain errors.

## Testing Guidance
- Unit-test state transitions and trait implementations.
- Use async tests for timeout, cancellation, duplicate handling, and backpressure.
- Add integration tests for protocol adapters and replay-sensitive flows.

## Operational Guidance
- Emit tracing spans with correlation IDs, retry attempts, route decisions, and terminal failures.
- Track latency, queue depth, task failures, and resource pressure.
- Treat ownership and lifetime choices as part of the design contract.
