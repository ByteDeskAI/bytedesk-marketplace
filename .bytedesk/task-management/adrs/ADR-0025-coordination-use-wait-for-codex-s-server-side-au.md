---
id: "ADR-0025"
kind: "adr"
status: "proposed"
created: "2026-09-27T02:50:36.103Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Coordination: use Wait for Codex's server-side audit to finish first (Recommended)"
epic: "EP-021"
decisionKey: "0a83760322d4"
date: "2026-09-27"
updated: "2026-09-27T02:50:36.110Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-27.
The question asked was: How should the two efforts be sequenced so they don't produce duplicate/conflicting tasks?

## Decision

**How should the two efforts be sequenced so they don't produce duplicate/conflicting tasks?** → chose **Wait for Codex's server-side audit to finish first (Recommended)**.

Rejected:
- **Proceed now, reconcile later** — File my epic + tasks (UI fix, 2 net-new items) now since they're mostly non-overlapping; merge Codex's findings into the same epic when it finishes
- **Split ownership explicitly** — I file only the UI/aside-modal task now (zero overlap); all issue-register/cross-plugin-recommendation tasks wait for and come from Codex's audit instead of mine

**Should I check what TM-482 is before proceeding, since it's server-side work already committed that didn't surface in my sweep?** → chose **Yes, check it now (Recommended)**.

Rejected:
- **Skip it, not relevant right now** — Proceed without checking; revisit if it turns out to matter later

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._