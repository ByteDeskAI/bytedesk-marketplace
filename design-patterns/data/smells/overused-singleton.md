---
slug: overused-singleton
name: Overused Singleton
domain: object-smell
category: Architecture Smells
groups:
  - architecture-smell
patterns:
  - singleton
  - factory-method
  - adapter
references:
  - skills/architecture-issue-scan/references/implementation.md
  - skills/pattern-advisor/references/implementation.md
---

# Overused Singleton

## Symptom
Global instances are used for convenience, configuration, service lookup, or mutable process-wide state.

## Why It Matters
Tests become order-dependent, hidden dependencies grow, and runtime behavior becomes hard to isolate.

## Pattern Responses
- Use Singleton only for truly singular immutable process resources.
- Use explicit construction, framework-managed dependency injection, or factory functions for most dependencies.
- Use Factory Method when creation variation is the real force.

## False Positives
A framework-managed singleton lifetime can be fine when dependencies are explicit and state is immutable or thread-safe.

## Checks
- Does the singleton hold mutable business state?
- Can tests run in parallel without shared-state leakage?
- Are dependencies visible in constructors or function parameters?
