---
name: map
description: Chart a foggy, multi-session effort as a decision map on the task store — an epic labelled decision:map whose children are interview/research/prototype/unblock tickets — then work the frontier one ticket at a time until the way is clear. Use when the destination can be named but the route cannot, or the user says /map, "chart this", "too big for one session".
user-invokable: true
argument-hint: "[destination, or an EP-id of an existing map]"
---

# Map

Plans. Does not build. Each child ticket is a **question**, not a slice of the product.

## Labels (never Matt names)

- Epic: `decision:map`
- Tickets: `decision:interview` | `decision:research` | `decision:prototype` | `decision:unblock`
- Implementation tickets must **not** wear `decision:*`

Use MCP `tm_epic`, `tm_task_create` (with `labels`), `tm_label`, `tm_next`, `tm_claim`, `tm_evidence`, `tm_ac_accept`, `tm_task_update`. Prefer `.bytedesk/bin/tm` over a global `tm`. Never write `.scratch/`.

## Chart (no map yet)

1. `/task-management:interview` until the **destination** is one or two lines.
2. `tm_epic` new with that title. Body:

```markdown
## Destination

<what reaching the end looks like>

## Notes

<skills every session should consult>

## Decisions so far

## Not yet specified

## Out of scope
```

3. `tm_label` add `decision:map` on the epic.
4. Mint only the tickets you can phrase **now**. Template via `tm task new --template interview|research|prototype|unblock`, or `tm_task_create` + labels. Wire `blockedBy` in a **second pass**.
5. Fog that is not yet a sharp question stays in **Not yet specified**.
6. Fire `decision:research` tickets as AFK subagents in parallel (`/task-management:research`). Do not resolve interview/prototype/unblock in the charting session.
7. Stop.

If the opening interview surfaces **no fog**, stop and say the effort is small enough for `/task-management:interview` then `/task-management:spec` — no map.

## Work through

1. Load the map epic (low-res). Refer to tickets **by title**, not bare ids.
2. User-named ticket, else first `tm_next` child of this epic that wears `decision:*`.
3. `tm_claim` / start **before** any work.
4. Resolve with the matching skill. One non-research ticket per session.
5. Write `## Answer` on the task, tick AC, `tm_task_update` done. Append one gist line to the epic's **Decisions so far**.
6. Graduate fog into new tickets; close mis-scoped tickets and move them to **Out of scope**.

**Plan, don't do.** A ticket titled "build X" is mis-typed. `decision:unblock` is only for work that unblocks a *decision*.
