---
name: dispatch
description: Hand one ready-for-agent task to a worker end to end — claim, start, worktree, handoff, spawn (orchestration → fleet → tmux → manual). Use when the user says "dispatch this", "run this on an agent", "spawn a worker for TM-N", "/dispatch", or a labelled card should execute without this session doing the work.
user-invokable: true
argument-hint: "<TM-id> [--backend orchestration|fleet|tmux|manual] [--steal]"
---

# Dispatch

One verb for the whole hand-off. Dispatch **is** a start: the WIP gate applies
exactly as it does to `tm start`. On any failure after the claim, the claim is
released and the status put back.

## When to use

The task is labelled `ready-for-agent`, unblocked, and this session should not
implement it. For a loop over many cards, [[pool]]. To do it yourself, [[implement]].

## Usage

```
.bytedesk/task-management/bin/tm label TM-014 ready-for-agent
.bytedesk/task-management/bin/tm caps --json
.bytedesk/task-management/bin/tm dispatch TM-014
.bytedesk/task-management/bin/tm dispatch TM-014 --backend tmux
.bytedesk/task-management/bin/tm dispatch TM-014 --steal
```

MCP: `tm_dispatch` `{ "id": "TM-014", "backend": "tmux", "steal": false }`.
HTTP: `POST /api/task/TM-014/dispatch` `{ "backend": "tmux" }` — 409 carries the
CLI's wording.

`--backend` pins one name and skips the fallback walk. Default order:
orchestration → fleet → tmux → manual (`dispatch.backends`). Every spawn is
argv-only, `shell: false`. Tmux also writes `<worktree>/.tm-dispatch-prompt.md`.

Worker env: `TM_SESSION_ID`, `TM_ACTOR` (dispatcher), `TM_ROOT` (repo). Do not override.

## Refusals

not found; `done`/`deleted` (reopen first); no backend (`tried` lists why);
already dispatched with a live claim (`collect` first, or `--steal`); another
session holds the claim (needs `--steal`); WIP (`gateStart`).

## After it starts

The worker ticks AC, attaches evidence, `tm done` or `tm block`. This session
runs [[collect]], reaps with [[agent]], and watches [[events]]. Probe first with [[caps]].

Full table: `docs/agent-first.md`.
