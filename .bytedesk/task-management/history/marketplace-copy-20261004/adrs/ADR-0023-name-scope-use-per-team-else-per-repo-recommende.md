---
id: "ADR-0023"
kind: "adr"
status: "proposed"
created: "2026-10-02T02:14:08.755Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Name scope: use Per team, else per repo (Recommended)"
epic: "EP-021"
decisionKey: "8f251edc4e32"
date: "2026-10-02"
updated: "2026-10-02T02:14:08.761Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-02.
The question asked was: Prevent collisions by design: one live session per agent, and parallel work gets distinct agents whose persona names are allocated uniquely. Within what scope must a persona name be unique?

## Decision

**Prevent collisions by design: one live session per agent, and parallel work gets distinct agents whose persona names are allocated uniquely. Within what scope must a persona name be unique?** → chose **Per team, else per repo (Recommended)**.

Rejected:
- **Global across the fleet** — A persona name is never reused while live anywhere; simplest mental model, pool exhausts faster.
- **Per node + repo** — Only unique on one host; node segment separates hosts. No network registry needed, but two nodes in one team can both have 'ada'.

**If you spawn an agent that already has a live session, what happens?** → chose **if the session it was perviously working on has context for the new session, that context should be collected. then a new session should be created and passed if te context maes sense for the new session.**.

Rejected:
- **Reuse it (Recommended)** — Return the existing session (attach / deliver the new prompt to it). Never a second copy.
- **Refuse with an error** — Tell the caller the agent is busy and which session holds it; caller picks another agent.
- **Replace it** — Stop the old session and start fresh under the same name.

**When the persona name pool for a scope runs out (many parallel agents), what then?** → chose **Add a surname (Recommended)**.

Rejected:
- **Refuse new agents** — Cap concurrency at the pool size; caller must wait.
- **Grow the pool from config** — A configurable name list per team/repo.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._