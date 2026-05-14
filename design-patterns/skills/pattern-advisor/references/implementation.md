# Pattern Advisor Implementation Guidance

## Decision Checklist

Use a pattern when it removes a concrete force:

- variation is expected and already causing conditionals or duplication;
- dependencies point in the wrong direction;
- construction, behavior, or integration policy is leaking into callers;
- tests require awkward setup because responsibilities are mixed;
- operations need explicit failure, retry, or observability semantics.

Avoid a pattern when:

- the language has a simpler idiom;
- the variation is speculative;
- the abstraction would have one implementation for the foreseeable future;
- a framework primitive already solves the problem;
- naming the pattern would hide rather than clarify ownership.

## Object-Design Guidance

- Construction patterns should live at composition boundaries, not deep in domain logic.
- Structure patterns should protect callers from unstable external shapes or nested object graphs.
- Behavior patterns should isolate real behavior variation, not wrap one-line branches.
- Test through the behavior boundary, then add smaller unit tests for selection or collaboration seams.

## Integration-Design Guidance

- Always pair routing or messaging recommendations with failure handling.
- Mention idempotency when delivery is at-least-once or retry-driven.
- Mention correlation when the workflow crosses services, queues, or time.
- Mention dead-letter or invalid-message handling when messages can fail permanently.
- Mention observability when routes, transforms, or fanout are introduced.

## Language Notes

- C# and Java often use interfaces, DI, middleware, and framework lifetimes.
- TypeScript and Python often prefer functions, maps, protocols, and discriminated unions.
- Go often favors small consumer-owned interfaces and explicit construction.
- Rust often uses traits, enums, pattern matching, ownership, and typestate.
- C++ often needs explicit ownership, RAII, value semantics, and careful dynamic polymorphism.

