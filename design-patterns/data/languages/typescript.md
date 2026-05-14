---
slug: typescript
displayName: TypeScript / JavaScript
---

# TypeScript / JavaScript

## Object Design Idioms
- Prefer first-class functions, discriminated unions, modules, and plain objects before class-heavy pattern ports.
- Use Strategy as function maps, Adapter as boundary modules, and Observer through event emitters or reactive streams.
- Keep factories typed and narrow; avoid hiding simple object construction behind generic registries.

## Integration Stacks
- NestJS
- KafkaJS
- NATS
- BullMQ
- Temporal
- RxJS

## Implementation Notes
- Prefer discriminated unions, function maps, modules, middleware, and typed boundary objects before class-heavy ports of object patterns.
- In NestJS, RxJS, KafkaJS, BullMQ, NATS, or Temporal flows, keep handler idempotency and contract validation close to the boundary.
- Use adapters for SDKs and external APIs; keep provider-specific payloads out of domain and UI code.

## Testing Guidance
- Use focused tests for pure functions and strategy maps, contract tests for boundary modules, and integration tests for queue or workflow semantics.
- Verify runtime-selected behavior with typed fixtures and explicit failure cases.

## Operational Guidance
- Propagate correlation IDs through async contexts, job metadata, and outbound calls.
- Track retries, queue age, poison messages, and workflow timeouts with names meaningful to support teams.
