---
name: tickets
description: Break a spec or conversation into tracer-bullet implementation tasks with acceptance criteria and blockedBy edges. Use after /spec, or when a plan is ready to slice. Never put decision:* labels on these cards.
user-invokable: true
argument-hint: "[spec path or EP-id]"
---

# Tickets

Vertical slices: a complete path through the layers, demoable, one fresh context window each. Prefactors first.

1. Draft titles, **blocked by**, what it delivers.
2. Quiz the user on granularity and edges. Iterate until they approve.
3. `tm_task_create` under an **implementation** epic (not the `decision:map` epic if one exists — mixing confuses `tm_next`). Add AC. Label `ready-for-agent`. **No** `decision:*`.
4. Wire `blockedBy` after ids exist.

Work the frontier with `/task-management:implement`.
