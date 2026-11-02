---
id: "ADR-0020"
kind: "adr"
status: "proposed"
created: "2026-10-02T01:20:21.507Z"
board: "bytedeskai/bytedesk-marketplace"
title: "WIP limit: use Raise limit to 12 (Recommended)"
epic: "EP-021"
decisionKey: "11ee2c6e85eb"
date: "2026-10-02"
updated: "2026-10-02T01:20:21.515Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-02.
The question asked was: The board's WIP limit (10) blocks starting TM-273. In progress now: TM-217, 240, 241, 242, 248, 249, 257 (other work) plus my TM-272, 274, 277. TM-273 is still held for you, so the pool won't take it. How should I proceed?

## Decision

**The board's WIP limit (10) blocks starting TM-273. In progress now: TM-217, 240, 241, 242, 248, 249, 257 (other work) plus my TM-272, 274, 277. TM-273 is still held for you, so the pool won't take it. How should I proceed?** → chose **Raise limit to 12 (Recommended)**.

Rejected:
- **One-off override** — Start TM-273 past the limit via tm's override path, recorded on the board, leaving the limit at 10.
- **Wait** — Start TM-273 when TM-274 or TM-277 lands.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._