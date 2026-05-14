---
slug: legacy-boundary-adapter
name: Legacy Boundary Adapter
domain: boundary-playbook
category: Boundary Playbooks
groups:
  - architecture-playbook
patterns:
  - adapter
  - facade
  - messaging-gateway
  - channel-adapter
smells:
  - fragile-adapter
  - anemic-facade
references:
  - skills/architecture-decision/references/implementation.md
  - skills/pattern-application/references/implementation.md
---

# Legacy Boundary Adapter

## Intent
Isolate a legacy API, SDK, protocol, database, or message format behind a domain-friendly boundary.

## When To Use
- External or legacy contracts leak into domain code.
- Replacement is not immediate, but change isolation matters.
- Tests need a stable seam around the boundary.

## Avoid When
- The dependency is already idiomatic and stable.
- The wrapper only renames calls without hiding mismatch.
- Business rules drift into the adapter layer.

## Pattern Set
- Adapter for interface mismatch.
- Facade for simplifying a broad subsystem.
- Messaging Gateway or Channel Adapter for integration boundaries.

## Implementation Steps
1. Name the boundary by domain responsibility.
2. Map external concepts to internal concepts at the edge.
3. Keep translation, retries, and error mapping close to the boundary.
4. Add contract tests against representative external behavior.

## Verification
- Domain modules no longer import legacy SDK or protocol types.
- Boundary tests cover success, error, timeout, and schema drift cases.
- Replacement requires changing the adapter, not the domain.
