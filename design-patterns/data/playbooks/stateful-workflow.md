---
slug: stateful-workflow
name: Stateful Workflow
domain: object-playbook
category: Object Design Playbooks
groups:
  - architecture-playbook
patterns:
  - state
  - command
  - memento
  - observer
smells:
  - lifecycle-state-spread
  - god-service
references:
  - skills/architecture-decision/references/implementation.md
  - skills/pattern-application/references/implementation.md
---

# Stateful Workflow

## Intent
Make lifecycle transitions explicit when state-dependent behavior is scattered through conditionals.

## When To Use
- Behavior changes by lifecycle state.
- Transition rules are duplicated or inconsistent.
- Auditing or recovery needs stable transition records.

## Avoid When
- State is simple data with no state-specific behavior.
- A table or enum validation rule is enough.
- Workflow logic belongs in an existing orchestration engine.

## Pattern Set
- State for state-specific behavior.
- Command for explicit transition requests.
- Memento for recoverable snapshots where needed.
- Observer for local transition notifications.

## Implementation Steps
1. Identify the real lifecycle states and legal transitions.
2. Move state-specific behavior behind domain-named collaborators.
3. Preserve current behavior with transition parity tests.
4. Add audit or recovery hooks only when required.

## Verification
- Illegal transitions fail consistently.
- Each state has focused behavior tests.
- State transition audit data is sufficient for support.
