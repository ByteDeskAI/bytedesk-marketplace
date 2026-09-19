---
id: "ADR-0017"
kind: "adr"
status: "proposed"
created: "2026-09-13T21:32:03.419Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Goal: use Split TM-168 (Recommended)"
epic: "EP-021"
decisionKey: "d88752d99a3a"
date: "2026-09-13"
updated: "2026-09-13T21:32:03.426Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-13.
The question asked was: The goal requires TM-168 unblocked, which depends on TM-317 in your gateway repo. Its owner has no date, and my branch is parked on two questions only they can answer. How do you want the goal handled?

## Decision

**The goal requires TM-168 unblocked, which depends on TM-317 in your gateway repo. Its owner has no date, and my branch is parked on two questions only they can answer. How do you want the goal handled?** → chose **Split TM-168 (Recommended)**.

Rejected:
- **Clear the goal, keep TM-168 blocked** — End the goal now and leave TM-168 as one blocked task naming TM-317. Nothing closes, but the repeating goal check stops.
- **Keep it running, I'll wait** — Leave the goal open and unsatisfied until TM-317 lands. It will keep reporting unsatisfied every session until then.
- **Stop the TM-317 work too** — Hand the analysis back to the gateway session, abandon my two branches, and leave TM-168 waiting entirely on them.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._