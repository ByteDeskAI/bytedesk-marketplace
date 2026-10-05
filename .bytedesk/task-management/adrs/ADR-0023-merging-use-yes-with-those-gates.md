---
id: "ADR-0023"
kind: "adr"
status: "proposed"
created: "2026-09-25T20:29:28.875Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Merging: use Yes, with those gates"
epic: "EP-021"
decisionKey: "57f71abf0830"
date: "2026-09-25"
updated: "2026-09-25T20:29:28.883Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-25.
The question asked was: May I merge marketplace PRs myself (gh pr merge --merge into main) once each has Faro's approve verdict for its exact head and green CI? Candidates: #123 TM-217, #124 TM-234, #128 TM-241, #129 TM-240, #130 TM-242, plus #126 TM-238 and #127 TM-236 after review.

## Decision

**May I merge marketplace PRs myself (gh pr merge --merge into main) once each has Faro's approve verdict for its exact head and green CI? Candidates: #123 TM-217, #124 TM-234, #128 TM-241, #129 TM-240, #130 TM-242, plus #126 TM-238 and #127 TM-236 after review.** → chose **Yes, with those gates**.

Rejected:
- **Only #123 and #124** — The two the gateway lead named; the rest wait for you.
- **No, I'll merge** — I report each PR as ready and you merge.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._