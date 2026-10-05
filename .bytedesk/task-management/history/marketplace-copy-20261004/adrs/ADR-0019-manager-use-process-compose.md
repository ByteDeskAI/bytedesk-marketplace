---
id: "ADR-0019"
kind: "adr"
status: "proposed"
created: "2026-10-01T16:47:17.514Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Manager: use process-compose"
epic: "EP-021"
decisionKey: "000d4b36c837"
date: "2026-10-01"
updated: "2026-10-01T16:47:17.522Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-01.
The question asked was: PM2 is AGPL-3.0 (ao is MIT), its `pm2 startup` does not support Windows, and on Linux it installs a root-level unit (needs sudo, ignores your 'login only' choice). Every manager also needs the OS to start IT at login, so the per-OS registration remains either way. Which do you want?

## Decision

**PM2 is AGPL-3.0 (ao is MIT), its `pm2 startup` does not support Windows, and on Linux it installs a root-level unit (needs sudo, ignores your 'login only' choice). Every manager also needs the OS to start IT at login, so the per-OS registration remains either way. Which do you want?** → chose **process-compose**.

Rejected:
- **Own small manager (Recommended)** — The plan as written: ~100-line Node restart loop + one OS registration per platform. No new dependency, MIT-clean, works on Windows, user-level.
- **PM2 anyway** — Bundle PM2 as a dependency; accept AGPL, write our own Windows startup, and run its startup unit at user level instead of `pm2 startup`.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._