# Pattern Application Implementation Guidance

## Refactor Sequence

1. Establish current behavior with tests or focused inspection.
2. Identify the narrowest variation or integration boundary.
3. Introduce the pattern structure without changing behavior.
4. Move one behavior or route at a time.
5. Delete dead branching only after tests prove equivalence.
6. Keep follow-up cleanup separate from the core refactor.

## Object-Design Implementation

- Strategy: isolate algorithm variants behind a small function or interface.
- Adapter: translate at the boundary; keep business rules outside the adapter.
- Decorator: wrap one responsibility at a time and make wrapper order explicit.
- Facade: expose task-oriented methods and avoid becoming a god service.
- State: use only when lifecycle transitions carry behavior and rules.
- Visitor: prefer language pattern matching when it is clearer.

## Integration Implementation

- Channel patterns require ownership, retention, security, and naming policy.
- Routing patterns require observable rules and deterministic fallbacks.
- Transformation patterns require schema/version tests.
- Endpoint patterns require retry, duplicate, and terminal-failure tests.
- Operations patterns require correlation, logs/traces, replay policy, and access control.

## Testing

- Behavior tests prove public behavior is preserved.
- Selection tests prove resolvers, routers, or factories choose the expected implementation.
- Contract tests prove adapters and translators preserve meaning.
- Failure tests prove retry, dead-letter, idempotency, or timeout behavior.

