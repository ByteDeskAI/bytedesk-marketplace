---
slug: provider-abstraction
name: Provider Abstraction
domain: boundary-playbook
category: Boundary Playbooks
groups:
  - architecture-playbook
patterns:
  - bridge
  - strategy
  - abstract-factory
  - adapter
smells:
  - provider-switch-sprawl
  - overused-singleton
references:
  - skills/architecture-decision/references/implementation.md
  - skills/pattern-finder/references/implementation.md
---

# Provider Abstraction

## Intent
Support multiple providers or engines while keeping provider selection, configuration, and domain behavior separated.

## When To Use
- Providers vary independently from domain workflows.
- Provider-specific SDKs or payloads leak through callers.
- Runtime or tenant-specific selection is required.

## Avoid When
- There is only one stable provider and no near-term variation.
- The abstraction hides important provider capabilities.
- Selection rules are global state rather than explicit context.

## Pattern Set
- Bridge for separating abstraction from provider implementation.
- Strategy for runtime behavior selection.
- Abstract Factory when provider families must stay compatible.
- Adapter for each provider SDK boundary.

## Implementation Steps
1. Define the domain contract first.
2. Isolate provider SDKs behind adapters.
3. Keep selection policy outside provider implementations.
4. Add compatibility tests per provider.

## Verification
- Adding a provider does not change domain workflows.
- Provider-specific errors are mapped consistently.
- Selection can be traced and tested.
