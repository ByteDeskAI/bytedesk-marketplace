---
id: "ADR-0021"
kind: "adr"
status: "proposed"
created: "2026-09-25T20:26:55.358Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Lead autonomy: use Approve all"
epic: "EP-021"
decisionKey: "5a004ff164e5"
date: "2026-09-25"
updated: "2026-09-25T20:26:55.365Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-25.
The question asked was: The gateway lead relays that you approved a plan where, after you approve a plan, leads drive everything to release: they merge PRs (TM-249), cut over / deploy (TM-250), release (TM-250) and delete merged branches (TM-251), gated by a checkable plan grant (TM-248). Today ADR-0001 and the repo rules say humans merge, and deploy and branch deletion always need a human. Do you approve changing that policy here?

## Decision

**The gateway lead relays that you approved a plan where, after you approve a plan, leads drive everything to release: they merge PRs (TM-249), cut over / deploy (TM-250), release (TM-250) and delete merged branches (TM-251), gated by a checkable plan grant (TM-248). Today ADR-0001 and the repo rules say humans merge, and deploy and branch deletion always need a human. Do you approve changing that policy here?** → chose **Approve all**.

Rejected:
- **Merge + cleanup only** — Leads merge (TM-249) and clean up (TM-251) under the grant; cutover and release (TM-250) stay human.
- **Not yet** — Everything stays on hold; only the safe prompt rule (TM-252) proceeds.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._