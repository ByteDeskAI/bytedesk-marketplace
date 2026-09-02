---
name: agent
description: Dispatched-worker registry — list with derived liveness, heartbeat a name, reap the dead (parks their claimed tasks). Use when the user says "who is running", "reap dead workers", "agent heartbeat", "/agent", or a dispatched claim looks abandoned.
user-invokable: true
argument-hint: "[list|heartbeat <name>|reap]"
---

# Agent registry

Per-machine `agents.json` (gitignored). Dispatch registers every worker.
Liveness is derived: live pid, or a heartbeat fresher than `agentTtlMinutes`
(default 30; `0` disables). A broken file is a missing panel, never a failed
[[dispatch]].

## When to use

After [[dispatch]] / [[pool]], before blaming the board for a stuck
`in_progress` card. Pair with [[collect]] — reap parks; collect records the
backend's own completion signal.

## Usage

```
.bytedesk/task-management/bin/tm agent
.bytedesk/task-management/bin/tm agent heartbeat agent:TM-014-dispatch
.bytedesk/task-management/bin/tm agent reap
```

MCP: `tm_agents` `{ "action": "list"|"heartbeat"|"reap", "name": "…" }`.
HTTP: `GET /api/agents`. Heartbeat/reap are CLI/MCP; HTTP is the list.

`reap` marks quiet agents dead **and unparks the board behind them** — claimed
tasks are parked with the reason and claims released.

Config: `agentTtlMinutes`, `dispatch.heartbeatSeconds` (claim re-stamp while
alive). Watch the bus with [[events]].

Full table: `docs/agent-first.md`.
