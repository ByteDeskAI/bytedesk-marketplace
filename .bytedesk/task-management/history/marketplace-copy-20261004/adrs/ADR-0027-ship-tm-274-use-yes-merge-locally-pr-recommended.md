---
id: "ADR-0027"
kind: "adr"
status: "proposed"
created: "2026-10-02T03:04:22.462Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Ship TM-274: use Yes, merge locally + PR (Recommended)"
epic: "EP-021"
decisionKey: "90563e4faa41"
date: "2026-10-02"
updated: "2026-10-02T03:04:22.469Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-02.
The question asked was: When TM-274 is green, ship it like the last two: fast-forward the served branch, update the plugin, open a PR?

## Decision

**The role segment is capped at 16 characters, so long workflow names get cut (brand-identity-tournament → brand-identity-t). Raise the cap?** → chose **raise it to 48**.

Rejected:
- **Raise to 32 (Recommended)** — Full workflow names in every bundled workflow; a full name stays well under tmux and gateway limits (~150 chars worst case).
- **Keep 16** — Shorter names; long workflow names stay truncated (full name is in @ao-workflow).

**When TM-274 is green, ship it like the last two: fast-forward the served branch, update the plugin, open a PR?** → chose **Yes, merge locally + PR (Recommended)**.

Rejected:
- **PR only** — Push and open the PR; don't change the installed plugin yet.
- **Wait for TM-281** — Ship TM-274 and TM-281 together.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._