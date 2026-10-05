---
id: "TM-339"
kind: "task"
status: "open"
created: "2026-10-04T05:21:51.113Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management NATS backend: a missing nats module is reported as offline and queues writes forever (nats-backend.mjs:112)"
epic: "EP-026"
acceptance: [{"text":"A missing module fails loudly with a named error, not offline","done":false},{"text":"A test fails without the fix","done":false}]
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
updated: "2026-10-04T05:21:51.122Z"
---

From the high-effort code review of PR #179 (2026-10-04). import is inside the try that maps failures to offline. Verify the claim first-hand before fixing.