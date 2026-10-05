---
id: "ADR-0037"
kind: "adr"
status: "proposed"
created: "2026-10-03T22:51:16.974Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Merge + NATS: use Upgrade-first: point sessions at the new code"
epic: "EP-026"
decisionKey: "1542d96f5a83"
date: "2026-10-03"
updated: "2026-10-03T22:51:16.982Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-03.
The question asked was: Marketplace PR #179 is green on CI. The gateway PR #335 cannot get its check: TeamCity's queue has been stuck for hours with every build 'waiting for the build queue distribution process'. Separately, the new code migrates a machine's local NATS home so older clients (the installed 0.15.4) get authentication errors until upgraded; that is what happened on your machine today. How should I proceed?

## Decision

**Marketplace PR #179 is green on CI. The gateway PR #335 cannot get its check: TeamCity's queue has been stuck for hours with every build 'waiting for the build queue distribution process'. Separately, the new code migrates a machine's local NATS home so older clients (the installed 0.15.4) get authentication errors until upgraded; that is what happened on your machine today. How should I proceed?** → chose **Upgrade-first: point sessions at the new code**.

Rejected:
- **Hold merges; restore old clients first (Recommended)** — I add a temporary legacy password user to your live NATS server (with a backup of today's files) so installed 0.15.x clients work again, then wait for you to upgrade sessions before merging. Gateway PR waits for TeamCity.
- **Merge #179 now, fix NATS later** — Merge the green marketplace PR into main. Your live server keeps rejecting old clients until you upgrade every session or tell me to restore access. The gateway PR stays open.
- **Reset the live NATS home** — Stop your live server, move the home aside and let the installed code recreate it in the old format. Loses retained NATS state (streams, KV) in that home; backup kept.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._