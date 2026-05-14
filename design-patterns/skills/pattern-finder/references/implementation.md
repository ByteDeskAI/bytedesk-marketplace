# Pattern Finder Implementation Guidance

## Force Mapping

Map user language to catalog domains:

- "too many constructors" or "matching families" -> `object-construction`.
- "if/else for algorithms" -> `behavior-and-collaboration`.
- "wrapping logging/caching/security" -> `object-structure`.
- "workflow depends on message data" -> `message-routing`.
- "schema conversion" -> `message-transformation`.
- "consumer retry or duplicate handling" -> `message-endpoint`.
- "tracing, replay, dead letters" -> `operations-and-observability`.

## Search Strategy

1. Start broad with `patterns search "<term>"`.
2. Narrow by group: `object-design` or `integration-design`.
3. Add language only when the user names a stack.
4. Read the likely pattern files before answering.
5. Compare using intent, when-to-use, and avoid-when sections.

## Avoiding False Positives

- Do not recommend State when Strategy is enough; State requires lifecycle-driven behavior changes.
- Do not recommend Abstract Factory when one simple product varies.
- Do not recommend Mediator when a small direct service call is clear.
- Do not recommend publish-subscribe if exactly one consumer must act.
- Do not recommend guaranteed delivery without discussing duplicates and idempotency.

