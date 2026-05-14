---
slug: visitor
name: Visitor
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
  - composite
  - interpreter
  - iterator
relationships:
  - companion:composite
  - companion:interpreter
  - companion:iterator
references:
  - skills/architecture-decision/references/implementation.md
  - skills/pattern-advisor/references/implementation.md
  - skills/pattern-finder/references/implementation.md
  - skills/pattern-application/references/implementation.md
  - skills/architecture-issue-scan/references/implementation.md
---

# Visitor

## Intent
Represent operations over an object structure separately from the classes in that structure.

## When To Use
- A stable object structure needs many operations added over time.
- Operations need type-specific behavior across a hierarchy.
- You want to keep traversal separate from operation logic.

## Avoid When
- The object structure changes frequently.
- Pattern matching or multimethods are clearer in the language.
- Visitors become large switchboards with poor cohesion.

## Language Notes

### csharp
Pattern matching and discriminated-union libraries may replace classic visitors.

### java
Useful for ASTs; sealed classes and pattern matching reduce ceremony.

### typescript
Discriminated unions plus switch exhaustiveness often beat visitor classes.

### python
functools.singledispatch can be a lightweight visitor alternative.

### go
Use explicit type switches or visitor interfaces for stable trees.

### rust
Pattern matching over enums is usually the first choice.

### cpp
std::variant with visitors is idiomatic for closed sets; classic visitors fit open operations.

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
- Introduce Visitor at the smallest boundary where variation, construction, or collaboration changes independently.
- Prefer idiomatic language features before adding class-heavy structure.
- Keep public behavior stable first, then simplify old conditionals or construction paths once tests prove parity.
