---
name: pool
description: The pickup loop that dispatches ready-for-agent tasks, on by default — tm pool once|start|stop|status|resume, the tm-pool monitor, dispatch.enabled / poolWip / pollSeconds / maxFailures. Use when the user says "start the worker pool", "stop the pool", "pick up ready-for-agent work", "run the dispatch loop", "the pool is paused", "/pool", or many ready cards should drain without one-shot dispatch.
user-invokable: true
argument-hint: "[once|start|stop|status|resume] [--dry-run]"
---

# Pool

[[dispatch]] on a timer, **running by default**. Each tick collects finished
workers first, then dispatches open, unblocked, unclaimed `ready-for-agent` tasks
that still pass the readiness check, up to `dispatch.poolWip` (default 3),
preferring disjoint `touches`.

## When to use

**The pool is on by default** — usually there is nothing to start. Reach for this
skill to check on it, stop it, or clear its brake. For a single card, [[dispatch]].

## Usage

```
.bytedesk/task-management/bin/tm pool status                     # running? paused? how many ready?
.bytedesk/task-management/bin/tm pool once --dry-run             # what would it pick
.bytedesk/task-management/bin/tm pool once
.bytedesk/task-management/bin/tm pool resume                     # clear the brake
.bytedesk/task-management/bin/tm pool start
.bytedesk/task-management/bin/tm pool stop
.bytedesk/task-management/bin/tm config dispatch.enabled false   # turn it off for this repo
```

No MCP or HTTP verb. The plugin monitor `tm-pool` runs `tm pool run --auto`.
Config is re-read every poll, so `dispatch.enabled false` stops a running pool
within one poll; `TM_ENFORCE=off` also no-ops a tick.

**A label is not a go-ahead by itself.** Every candidate is re-checked against
`agentReadiness`, so a task missing its body, criteria or epic — or vetoed by a
person with `ready-for-human` — is skipped with the reason named.

**If it is paused**, `status` says why: `dispatch.maxFailures` failures in a row
(default 3), or one quota/rate-limit failure. Only a dispatched task reaching
done resets the count, and only `tm pool resume` clears the pause.

Config: `dispatch.enabled` (true), `dispatch.poolWip` (3),
`dispatch.pollSeconds` (30), `dispatch.maxFailures` (3),
`dispatch.maxRuntimeMinutes` (120), `dispatch.backendCaps` (e.g. `{"tmux":2}`),
`dispatch.backends`. Probe hosts with [[caps]] first.

<!-- TM-180/TM-178: the pool's process model (how it is started, how it detaches,
     idle exit) is being redesigned; document it here once that branch merges. -->

## After it runs

[[collect]] is what the tick already calls for finished workers; you can still
`tm collect <id>` by hand. [[agent]] `reap` parks stragglers. [[events]]
`--follow --json` is the bus.

Full table: `docs/agent-first.md`.
