---
id: "ADR-0024"
kind: "adr"
status: "proposed"
created: "2026-10-02T02:17:50.264Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Collect: use Agent writes a handoff (Recommended)"
epic: "EP-021"
decisionKey: "214718b93e89"
date: "2026-10-02"
updated: "2026-10-02T02:17:50.270Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-02.
The question asked was: Re-spawning an agent that has a live session: collect its context, end it, start a fresh session under the same name, and pass the context if relevant. How is the context collected?

## Decision

**Re-spawning an agent that has a live session: collect its context, end it, start a fresh session under the same name, and pass the context if relevant. How is the context collected?** → chose **Agent writes a handoff (Recommended)**.

Rejected:
- **Summarise the transcript** — Read the old session's transcript JSONL and summarise it, without interrupting the agent.
- **Both** — Handoff from the agent plus a transcript excerpt as evidence.

**Who decides whether the old context 'makes sense' for the new session?** → chose **Conductor/lead decides**.

Rejected:
- **New session decides (Recommended)** — The new session receives the handoff as a clearly labelled, optional brief and decides itself whether to use it.
- **Same task or repo rule** — Pass it automatically when the new work is the same task (TM key) or touches the same files; otherwise drop it.

**What if the old session is in the middle of a turn when the re-spawn arrives?** → chose **Wait for its turn to end (Recommended)**.

Rejected:
- **Interrupt it** — Interrupt, collect, replace immediately.
- **Refuse while busy** — Tell the caller the agent is busy; retry later.

**Where do the node name and team name come from?** → chose **ao config + env (Recommended)**.

Rejected:
- **NATS leaf config** — Read both from the NATS leaf-node configuration, so naming always matches the network.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._