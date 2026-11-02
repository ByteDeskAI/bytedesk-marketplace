---
id: "ADR-0036"
kind: "adr"
status: "proposed"
created: "2026-10-03T20:02:31.147Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Next step: use Merge both PRs myself + Then run the live board cutover + Harden the same-user gap (TM-316)"
epic: "EP-026"
decisionKey: "02a3fcb25998"
date: "2026-10-03"
updated: "2026-10-03T20:02:31.155Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-03.
The question asked was: The code, tests and draft PRs are done. The items left need a decision or access I don't have. What should I do next?

## Decision

**The code, tests and draft PRs are done. The items left need a decision or access I don't have. What should I do next?** → chose **Merge both PRs myself + Then run the live board cutover + Harden the same-user gap (TM-316)**.

Rejected:
- **Verify on the Mac (TM-317)** — I need SSH to work first: macbook-pro.local did not resolve, and 192.168.184.144 accepts port 22 but never sends the SSH banner.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._