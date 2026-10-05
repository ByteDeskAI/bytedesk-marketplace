---
id: "TM-337"
kind: "task"
status: "open"
created: "2026-10-04T05:21:49.932Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management NATS backend: replay empties the offline queue even when records failed (nats-backend.mjs:369)"
epic: "EP-026"
acceptance: [{"text":"A failed replay keeps the record queued and is retried","done":false},{"text":"A test fails without the fix","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "81e61d16-ae0f-495c-a2a4-7148fc8fa898"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-04T05:21:49.941Z"
---

From the high-effort code review of PR #179 (2026-10-04). Data loss of queued edits. Opt-in backend, so a blocker for TM-318 cutover, not for default use. Verify the claim first-hand before fixing.