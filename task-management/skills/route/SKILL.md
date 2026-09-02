---
name: route
description: Pick which task-management flow fits — board, enhance, interview, map, spec, tickets, implement, or the agent-first loop (caps → dispatch → pool → collect → events) — from live store state. Use when the user is unsure how to start.
user-invokable: true
argument-hint: "[what they have in front of them]"
---

# Route

Read `tm_board` / `tm_next` first.

| Situation | Flow |
|---|---|
| Unsure what's tracked | `/task-management:board` |
| What to build next | `/task-management:enhance` |
| Sharpen a small idea | `/task-management:interview` |
| Foggy, bigger than one session | `/task-management:map` |
| Deciding is done | `/task-management:spec` then `:tickets` |
| Startable implementation card | `/task-management:implement` |
| Labelled `ready-for-agent`, not this session | `/task-management:dispatch` or `:pool` → `:collect` → `:events` |
| Hard bug | existing bug template + tight repro loop |

Do not invent a second tracker. Do not use Matt Pocock command names as slash commands.
Agent-first recipe: `docs/agent-first.md`. [[caps]] first.
