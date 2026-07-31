---
id: "ADR-0001"
kind: "adr"
status: "proposed"
created: "2026-07-31T02:02:12.067Z"
title: "Data source: use The claiming session's transcript"
epic: null
decisionKey: "c58f05488600"
date: "2026-07-31"
updated: "2026-07-31T02:02:12.068Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-07-31.
The question asked was: What should the work stream actually show for an in-progress task?

## Decision

**What should the work stream actually show for an in-progress task?** → chose **The claiming session's transcript**.

Rejected:
- **Store events for the task** — Filter the existing events.jsonl SSE feed by task id: claims, status changes, comments, AC ticks, and subagent_stop answers (the store already records what each agent concluded). No new server route — the data and the live feed both exist today.
- **Both — events now, transcript later** — Ship the events panel this pass (it satisfies four of the five criteria), and split the transcript stream into its own task on EP-003. Keeps TM-035 closeable today.

**The ticket's fourth criterion says "uses the TanStack AI components" — nothing is installed. How do you want that read?** → chose **Add @tanstack/ai-react**.

Rejected:
- **ADS primitives only** — Build with the Atlaskit primitives the rest of the board already uses. No new dependency in a bundle that's already 4.6 MB. I'd amend that criterion on the ticket and say why.
- **Whichever fits the data** — Transcript source → TanStack AI, since that's genuinely a message stream. Events source → ADS, since events aren't chat messages. Let the first answer decide.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._