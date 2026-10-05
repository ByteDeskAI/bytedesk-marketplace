---
id: "ADR-0018"
kind: "adr"
status: "proposed"
created: "2026-10-01T15:01:32.991Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Source repo: use ByteDeskAI clone (Recommended)"
epic: "EP-021"
decisionKey: "3b618bb92df4"
date: "2026-10-01"
updated: "2026-10-01T15:01:32.999Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-01.
The question asked was: Your installed ao plugin is built from ~/Documents/GitHub/ByteDeskAI/bytedesk-marketplace (branch fix/ao-local-nats-autostart, 200 uncommitted files, includes local NATS). This '(copy)' repo is on main and is OLDER for ao. Where should the change be made?

## Decision

**Your installed ao plugin is built from ~/Documents/GitHub/ByteDeskAI/bytedesk-marketplace (branch fix/ao-local-nats-autostart, 200 uncommitted files, includes local NATS). This '(copy)' repo is on main and is OLDER for ao. Where should the change be made?** → chose **ByteDeskAI clone (Recommended)**.

Rejected:
- **This (copy) repo, main** — Edit here on a feature branch. Won't reach the installed plugin until merged and the marketplace points at it; lacks the NATS autostart code.

**Should the services keep running when you are not logged in (after reboot, before login)? That needs `loginctl enable-linger ryan`, a one-time system setting.** → chose **No, login only**.

Rejected:
- **Yes, enable linger (Recommended)** — Services start at boot and survive logout. The installer runs enable-linger once, after showing you.

**The remote gateway (separate repo) shows the error and only tells you to run the command by hand. Include a gateway change too?** → chose **Yes, small gateway change (Recommended)**.

Rejected:
- **No, ao only** — Leave the gateway as is; auto-restart alone makes the error rare.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._