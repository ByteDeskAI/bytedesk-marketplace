---
slug: rust
displayName: Rust
---

# Rust

## Object Design Idioms
- Prefer traits, enums, pattern matching, ownership boundaries, and zero-cost abstractions.
- Use Strategy with generic trait bounds or trait objects depending on whether runtime dispatch is needed.
- Builder is common for complex configuration; Singleton usually becomes explicit shared state with OnceLock or dependency injection.

## Integration Stacks
- Tokio
- async-nats
- rdkafka
- lapin
- Axum
- Tower

## Implementation Notes
- Prefer traits, enums, pattern matching, ownership boundaries, generics, and explicit state machines before runtime polymorphism.
- For Tokio, async-nats, rdkafka, lapin, Axum, and Tower, keep backpressure, cancellation, retry, and error mapping explicit.
- Use trait objects only when runtime selection is required; otherwise prefer static dispatch and domain-specific types.

## Testing Guidance
- Use unit tests for enum transitions and trait implementations, property tests for protocol rules, and integration tests for async flow semantics.
- Test replay and duplicate handling around durable state changes.

## Operational Guidance
- Emit tracing spans with correlation IDs, route decisions, retry attempts, and terminal failures.
- Make ownership and lifetime decisions visible in APIs rather than hidden behind global state.
