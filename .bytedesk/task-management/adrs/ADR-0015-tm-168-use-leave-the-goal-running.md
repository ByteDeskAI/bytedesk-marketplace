---
id: "ADR-0015"
kind: "adr"
status: "proposed"
created: "2026-09-13T20:09:04.153Z"
board: "bytedeskai/bytedesk-marketplace"
title: "TM-168: use Leave the goal running"
epic: "EP-021"
decisionKey: "59ae552bf982"
date: "2026-09-13"
updated: "2026-09-13T20:09:04.159Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-13.
The question asked was: TM-168's marketplace work is complete and countersigned; only the browser screenshot is blocked, on the gateway's TM-317 sandbox fix. How should the board record that?

## Decision

**TM-168's marketplace work is complete and countersigned; only the browser screenshot is blocked, on the gateway's TM-317 sandbox fix. How should the board record that?** → chose **Leave the goal running**.

Rejected:
- **Split it (Recommended)** — Close TM-168 as done for the marketplace scope — emit, render, countersign, all shipped in v0.9.0. File a new EP-019 task for the browser acceptance, blocked on the gateway's TM-317, closing when they send the screenshot showing both the derived and transmitted characters.
- **Accept it as blocked, clear the goal** — Leave TM-168 as one task in blocked state naming TM-317, and end the goal now. The board stays accurate; nothing closes until the gateway acts.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._