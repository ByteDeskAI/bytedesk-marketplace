---
slug: abstract-factory
name: Abstract Factory
domain: object-construction
category: Construction
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
  - factory-method
  - builder
  - prototype
relationships:
  - alternative:factory-method
  - companion:builder
  - companion:prototype
references:
  - skills/architecture-decision/references/implementation.md
  - skills/pattern-advisor/references/implementation.md
  - skills/pattern-finder/references/implementation.md
  - skills/pattern-application/references/implementation.md
  - skills/architecture-issue-scan/references/implementation.md
---

# Abstract Factory

## Intent
Create related families of objects through stable interfaces without binding clients to concrete product classes.

## When To Use
- A caller must create several compatible objects that vary as a family.
- Product families change by platform, tenant, theme, provider, or environment.
- Construction policy belongs at a boundary rather than in domain logic.

## Avoid When
- Only one object varies; Factory Method or a simple factory is enough.
- A dependency injection container already owns the variation cleanly.
- The factory hierarchy is larger than the product hierarchy.

## Language Notes

### csharp
Use interfaces plus DI registrations or factory delegates; keep the factory itself small and testable.

### java
Works well with interfaces and provider modules; avoid duplicating Spring configuration in factory classes.

### typescript
Prefer typed object factories or provider maps over abstract class trees.

### python
Use protocols or callable factories; module-level factories are often sufficient.

### go
Return interfaces from explicit constructor functions only when the caller benefits from abstraction.

### rust
Use traits and associated factory functions; generics may remove the need for runtime factories.

### cpp
Use abstract product interfaces with smart pointers and clear ownership.

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
- Introduce Abstract Factory at the smallest boundary where variation, construction, or collaboration changes independently.
- Prefer idiomatic language features before adding class-heavy structure.
- Keep public behavior stable first, then simplify old conditionals or construction paths once tests prove parity.
