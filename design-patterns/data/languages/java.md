---
slug: java
displayName: Java / JVM
---

# Java / JVM

## Object Design Idioms
- Use interfaces, records, enums, lambdas, sealed types, builders, and dependency injection frameworks judiciously.
- Prefer Strategy, Template Method, and Factory Method when framework extension points already expect them.
- Watch for overuse of Abstract Factory and Singleton in codebases already managed by Spring or Jakarta EE.

## Integration Stacks
- Apache Camel
- Spring Integration
- Spring Cloud Stream
- Kafka Streams
- JMS
- RabbitMQ

## Implementation Notes
- Use Spring, Jakarta, Camel, or framework extension points when they already express factories, strategies, filters, routes, and endpoints.
- Keep pattern boundaries domain-named; avoid overusing abstract factories or singletons in code already managed by dependency injection.
- For integration work, make route definitions, message contracts, error channels, and transaction boundaries explicit.

## Testing Guidance
- Use unit tests for strategy and state variants, slice tests for framework wiring, and contract tests for message schemas.
- Exercise retry, dead-letter, transaction, and idempotency behavior with representative broker or framework tests.

## Operational Guidance
- Surface correlation IDs, route IDs, consumer lag, handler latency, and dead-letter counts through the platform observability stack.
- Treat schema evolution and replay as operational features, not afterthoughts.
