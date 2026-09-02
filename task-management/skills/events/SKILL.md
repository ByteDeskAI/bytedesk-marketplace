---
name: events
description: Raw task-store event stream — tm events [--json] [--follow] [--since], webhooks, dashboard SSE. Use when the user says "tail the board events", "webhook the store", "follow JSONL", "/events", or a machine (not a person) needs what tm log renders for humans.
user-invokable: true
argument-hint: "[n] [--json] [--follow] [--since <iso>]"
---

# Events

`tm log` is for people. This is the machine bus — the same rows `events.jsonl`
holds, plus optional webhooks.

## When to use

After [[dispatch]] / [[pool]] / [[collect]], when wiring a subscriber, or when
`tm log` labels are the wrong shape. Completes the chain:
[[caps]] → [[dispatch]] → [[pool]] → [[collect]] → [[agent]] → **events**.

## Usage

```
.bytedesk/task-management/bin/tm events
.bytedesk/task-management/bin/tm events 40 --json
.bytedesk/task-management/bin/tm events --since 2026-09-01T00:00:00.000Z --json
.bytedesk/task-management/bin/tm events --follow --json
```

`--json` is JSONL (one object per line), not a pretty array. `--follow` is a
byte-offset tail that survives rotation; SIGINT exits 0. A bad `--since` is
refused.

HTTP: `GET /api/events?since=&limit=&id=`, SSE `GET /events` (`Last-Event-ID`).
No MCP tool — shell the CLI or hit the dashboard.

Webhooks: config `webhooks` `[{url, kinds?}]`. Loopback only unless
`webhooksAllowRemote: true`. Delivery is detached (`bin/tm-webhook`).

Full table: `docs/agent-first.md`.
