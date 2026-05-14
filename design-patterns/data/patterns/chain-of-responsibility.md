---
slug: chain-of-responsibility
name: Chain of Responsibility
domain: behavior-and-collaboration
category: Behavior and Collaboration
groups:
  - object-design
languages:
  - csharp
  - java
  - typescript
  - python
  - go
  - rust
  - cpp
qualityAttributes:
  - maintainability
  - testability
  - evolvability
implementationComplexity: low-to-medium
operationalRisk: low
tradeoffs:
  - Adds explicit structure and vocabulary for the force.
  - Can become ceremony when the force is small or temporary.
  - Requires tests that prove the new boundary preserves behavior.
failureModes:
  - Pattern name becomes more important than the problem force.
  - Ownership and lifecycle rules remain implicit.
  - The implementation hides simpler language or framework idioms.
testingFocus:
  - Behavior parity at the public boundary.
  - Variant or flow-specific edge cases.
  - Regression checks for the force the pattern addresses.
observabilityFocus:
  - Decision points that affect runtime behavior.
  - Failure paths introduced by the new boundary.
  - Signals useful for support and rollback.
related:
  - command
  - composite
relationships:
  - companion:command
  - companion:composite
references:
  - skills/architecture-decision/references/implementation.md
  - skills/pattern-advisor/references/implementation.md
  - skills/pattern-finder/references/implementation.md
  - skills/pattern-application/references/implementation.md
  - skills/architecture-issue-scan/references/implementation.md
---

# Chain of Responsibility

## Intent
Pass a request along a chain of handlers until one handles it or the chain completes.

## When To Use
- Multiple handlers may process or reject a request in sequence.
- The sender should not know which handler will respond.
- Handler order is configurable or policy-driven.

## Avoid When
- The chain makes control flow invisible.
- Every request should always be handled by a known component.
- A pipeline or middleware abstraction already exists.

## Language Notes

### csharp
ASP.NET middleware and MediatR behaviors are common chain forms.

### java
Servlet filters, Spring interceptors, and validation chains are familiar forms.

### typescript
Middleware arrays or handler pipelines are idiomatic.

### python
Decorator stacks and middleware chains often cover this.

### go
HTTP middleware and functional chaining are idiomatic.

### rust
Tower services and layers provide a strong chain model.

### cpp
Use explicit handler ownership and avoid null-next ambiguity.

## Forces
- Keep the variation point explicit without spreading conditionals or construction knowledge through callers.
- Preserve domain names and dependency direction while making behavior easier to test in isolation.
- Balance indirection against the simplicity of language-native functions, modules, records, or interfaces.

## Tradeoffs
- Improves local change isolation, but can add indirection that obscures straightforward code.
- Creates better test seams when behavior truly varies, but can fragment logic when the variation is small.
- Works best when the abstraction is named after the domain role rather than the pattern label.

## Failure Modes
- Introducing the pattern before the variation point is stable enough to justify a boundary.
- Leaking host object state into collaborators until the design becomes harder to reason about.
- Naming production types after generic pattern roles instead of domain concepts.

## Testing
- Test through the behavior boundary that callers actually use.
- Add focused tests for each variant, construction path, or collaboration rule introduced by the pattern.
- Preserve behavior with parity tests before deleting old branches or constructors.

## Observability
- For runtime-selected variants, log the selected domain strategy, factory path, state, or collaborator role at debug or trace level.
- Avoid noisy pattern-level logs; surface only decisions that help diagnose production behavior.
- Add metrics only when the pattern changes runtime routing, cost, latency, or failure behavior.

## Implementation Notes
- Introduce Chain of Responsibility at the smallest boundary where variation, construction, or collaboration changes independently.
- Prefer idiomatic language features before adding class-heavy structure.
- Keep public behavior stable first, then simplify old conditionals or construction paths once tests prove parity.
