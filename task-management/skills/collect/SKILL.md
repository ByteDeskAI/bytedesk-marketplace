---
name: collect
description: Pull a dispatched worker's result into the store — never closes the task; parks and releases on failure. Use when a worker has exited, after tm dispatch / tm pool, when the board still shows in_progress for a dead run, or the user says "collect TM-N", "what happened to that worker", "/collect".
user-invokable: true
argument-hint: "<TM-id>"
---

# Collect

Each backend's completion signal (orchestration terminal state, tmux session
gone, fleet merge/error) normalizes through one write path. The worker closes
the task with `tm done`; this verb records how that ended.

## When to use

After [[dispatch]] or a [[pool]] tick. When `tm agent list` shows a dead worker
still holding a card. Not for work this session implemented — that is [[implement]].

## Usage

```
.bytedesk/task-management/bin/tm collect TM-014
```

MCP: `tm_collect` `{ "id": "TM-014" }`.
HTTP: `POST /api/task/TM-014/collect`.

Returns `{ ok, outcome, downgraded?, parked? }` or `{ ok, pending: true }` while
the worker still runs.

## Invariants

- Never closes a task. A "done" report on a task that is not done **downgrades
  to failed** and names the status.
- `blocked`/`failed` on still-`in_progress` **parks** it with the summary and
  **releases the claim**.
- Comment + `task_result` event — `tm log <id>` / [[events]] tell the story.
- Never throws. `{ ok: false, reason }` if never dispatched or no collector.

Then [[agent]] `reap` for anyone collect missed. Watch [[events]].

Full table: `docs/agent-first.md`.
