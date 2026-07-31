---
id: "EP-005"
kind: "epic"
status: "done"
created: "2026-07-31T07:35:13.853Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management 0.12 — someone else can install it"
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T09:02:49.748Z"
closed: "2026-07-31T09:02:49.745Z"
---

## Why this epic
Every round so far has been verified by the person who wrote it, on the machine that already had
everything set up. That is a real bar and this plugin clears it: 811 tests, real transcripts, real
payloads, real browsers.

It is not the bar that matters for a plugin. The question this round asks is different: **can
somebody else install this and have it work?**

The first check found a failure immediately. TM-042 shipped `hooks/codex-hooks.example.json`
telling users to run `tm-hook`, and moved the capability matrix from ⚠️ to ✅ on the strength of a
payload test. `tm-hook` does not exist — `bin/` contains `tm`, `tm-dashboard`, `tm-mcp` and
`tm-notify`. The feature works; the documented way to reach it does not. Nobody would have found
that by running the tests, because the tests invoke `hooks/tm-hook.sh` by absolute path.

## What belongs here
- setup paths that are documented but untried
- anything a clean machine needs that this one already had
- what a client sees, as opposed to what the code does

## What does not
Features. This round makes the existing ones reachable.
