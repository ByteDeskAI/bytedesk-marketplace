---
slug: provider-switch-sprawl
name: Provider Switch Sprawl
domain: boundary-smell
category: Architecture Smells
groups:
  - architecture-smell
patterns:
  - bridge
  - strategy
  - adapter
  - abstract-factory
references:
  - skills/architecture-decision/references/implementation.md
  - skills/pattern-finder/references/implementation.md
---

# Provider Switch Sprawl

## Symptom
Provider, engine, tenant, or region selection is repeated across services, handlers, or UI code.

## Why It Matters
Adding or changing a provider requires broad edits and makes compatibility behavior inconsistent.

## Pattern Responses
- Use Bridge to separate domain abstraction from provider implementation.
- Use Strategy for explicit runtime selection.
- Use Adapter for provider SDK boundaries.
- Use Abstract Factory when compatible provider families must be created together.

## False Positives
A small local switch can be fine if provider variation is temporary or limited to one composition boundary.

## Checks
- How many files switch on provider name?
- Are provider-specific payloads leaking into domain code?
- Can provider compatibility be tested independently?
