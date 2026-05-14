---
slug: cpp
displayName: C++
---

# C++

## Object Design Idioms
- Use RAII, templates, value semantics, smart pointers, and policies before introducing heap-heavy object networks.
- Factory, Prototype, Strategy, and Visitor still appear often, but ownership should be explicit.
- Prefer modern C++ variants and concepts where they make runtime polymorphism unnecessary.

## Integration Stacks
- Boost.Asio
- ZeroMQ
- Poco
- gRPC
- Kafka clients
- DDS

## Implementation Notes
- Use RAII, value semantics, smart pointers, templates, concepts, and policy types before heap-heavy object networks.
- For Boost.Asio, ZeroMQ, Poco, gRPC, Kafka, or DDS integrations, define ownership, threading, backpressure, and retry boundaries explicitly.
- Keep adapters responsible for protocol translation and resource lifetime; avoid leaking raw handles into domain code.

## Testing Guidance
- Use unit tests for value and policy behavior, contract tests for adapters, and stress tests for concurrency or ownership-sensitive flows.
- Test error paths, resource cleanup, retry behavior, and cancellation under realistic timing.

## Operational Guidance
- Expose correlation, route decisions, queue depth, handler latency, and resource pressure with low-overhead telemetry.
- Treat memory ownership, thread ownership, and replay safety as part of the architecture decision.
