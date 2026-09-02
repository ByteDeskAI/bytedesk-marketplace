---
name: pool
description: Dispatch ready-for-agent tasks on a loop — tm pool once|start|stop|status, the tm-pool monitor, dispatch.poolWip / pollSeconds / enabled. Use when the user says "start the worker pool", "pick up ready-for-agent work", "run the dispatch loop", "/pool", or many labelled cards should drain without one-shot dispatch.
user-invokable: true
argument-hint: "[once|start|stop|status] [--dry-run]"
---

# Pool

[[dispatch]] on a timer. Each tick collects finished workers first, then
dispatches open, unblocked, unclaimed `ready-for-agent` tasks up to
`dispatch.poolWip` (default 3), preferring disjoint `touches`.

## When to use

Several cards already carry `ready-for-agent` and a human has opted in. For a
single card, [[dispatch]]. The pool never guesses at unlabelled work.

## Usage

```
.bytedesk/task-management/bin/tm config dispatch.enabled true
.bytedesk/task-management/bin/tm pool once --dry-run
.bytedesk/task-management/bin/tm pool once
.bytedesk/task-management/bin/tm pool start
.bytedesk/task-management/bin/tm pool status
.bytedesk/task-management/bin/tm pool stop
```

No MCP or HTTP verb. The plugin monitor `tm-pool` runs `tm pool run --auto` and
**exits 0 immediately** unless `dispatch.enabled` is true. Explicit `once|start`
work regardless of that flag; a tick still no-ops when `TM_ENFORCE=off` or
`dispatch.enabled: false`.

Config: `dispatch.poolWip` (3), `dispatch.pollSeconds` (30),
`dispatch.backendCaps` (e.g. `{"tmux":2}`), `dispatch.backends`.
Probe hosts with [[caps]] first.

## After it runs

[[collect]] is what the tick already calls for finished workers; you can still
`tm collect <id>` by hand. [[agent]] `reap` parks stragglers. [[events]]
`--follow --json` is the bus.

Full table: `docs/agent-first.md`.
