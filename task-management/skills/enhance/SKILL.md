---
name: enhance
description: Product capability loop — capture current product state, research external analogues and internal seams, propose ranked capability cards into the task store, and track them to shipped. Use when the user runs /enhance, says "enhance the product", "what should we build next", "capability backlog", or asks for product improvements grounded in research rather than opinion.
user-invokable: true
argument-hint: "[optional: research only | propose | area <ux|platform|ops>]"
---

# Enhance

The backlog of *what to build* lives in the same store as the work itself:
capabilities (`CAP-*`) are the discovery layer, tasks (`TM-*`) the execution layer.
A capability becomes work by being accepted, which mints the task.

Proposing is not committing. **Do not implement anything** in this loop unless the
user names a capability to build.

## Store

- `tm cap list` — the ranked backlog (this is the registry; there is no index file to hand-edit)
- `.bytedesk/task-management/product-state.md` — current product state, written by [[enhance-capture]]
- `.bytedesk/task-management/research/<date>-<slug>.md` — research packs, written by [[enhance-research]]
- `tm log` — the history. Capability events are `cap-accept`, `cap-ship`, `cap-drop`.

## The loop

Run in order. Skip a step only when the user scopes it (`/enhance research only`).

1. **Capture** — [[enhance-capture]]: refresh `product-state.md` from repo reality. Proposals
   built on stale memory are the failure mode this step exists to prevent.
2. **Load the backlog** — `tm cap list`. Summarize counts by status. A problem already on
   the board must not be proposed twice.
3. **Research** — [[enhance-research]]: internal always, external when web tools exist.
4. **Propose** — [[enhance-propose]]: 5–15 ranked capabilities, each with acceptance criteria
   and at least one evidence seed.
5. **Hand off** — present the top 3 with impact/effort/confidence and a one-line why. Stop there.
6. **Track** — [[enhance-track]]: anything the tree shows is actually done gets marked shipped,
   with evidence.

## Quality bar

- Grounded in `product-state.md` and a research pack — not in what you remember about the repo.
- Vertical slices over platform rewrites. A capability someone can finish in a PR or two.
- Acceptance criteria that a test or a command can settle, because on accept they *become*
  the task's gate and `tm done` will refuse without them.
- Score is `impact × ease × confidence` (see [[enhance-propose]]). Low-confidence ideas are
  worth proposing at `--confidence L`; they rank themselves down without being lost.

## Related

[[board]] for what is already in flight, [[epic]] to group accepted capabilities,
[[adr]] when a proposal implies a decision someone would otherwise reverse-engineer.
