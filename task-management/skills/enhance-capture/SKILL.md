---
name: enhance-capture
description: Snapshot what the product actually does today into .bytedesk/task-management/product-state.md, so capability proposals are grounded in the repo rather than in session memory. Use as step 1 of /enhance, or when the user asks to refresh product state or capability context.
user-invokable: false
---

# Enhance — capture

Write an accurate **current state** document. Facts from the tree only; no wishes, no proposals.

## Steps

1. Read the project's own instructions first — `AGENTS.md` / `CLAUDE.md`, `README.md` (skim),
   ADR titles (`tm find kind:adr`, plus `docs/adr/*.md` if the project keeps them there).
2. Inventory the **surfaces** a user touches. Discover them; do not assume a stack:
   - a frontend: route/nav definitions, page and feature directories
   - a service: route registration, the handler table, public API prefixes
   - a CLI: the subcommand list
3. Inventory **operations**: deploy and release scripts, service units, health checks,
   runtime state locations. Record paths, never secrets.
4. Record **constraints** that bound any future proposal — auth rules, CSP, formatting and
   test gates, "do not change X" lines from the project instructions.
5. Record **known friction**, evidenced: TODO/FIXME clusters, skipped tests, debug-shaped UI
   (raw JSON dumps), restore/durability gaps, anything the docs admit is unfinished.
6. Overwrite `.bytedesk/task-management/product-state.md` using the shape below.

## Shape

```markdown
# Product state — <project>

Updated: <ISO date>

## One-liner
<what this product is, in a sentence>

## Surfaces
| Area | Entry | Notes |
|------|-------|-------|

## Platform
- <stack, deployment shape, extension points>

## Constraints
- <the rules any proposal must not break>

## Known friction (facts only)
- <bullet, each with a path>
```

## Do not

- Propose capabilities here — that is [[enhance-propose]].
- Copy secrets out of env files, config, or credential stores into the document.
