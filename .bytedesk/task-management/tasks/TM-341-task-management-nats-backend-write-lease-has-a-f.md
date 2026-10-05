---
id: "TM-341"
kind: "task"
status: "open"
created: "2026-10-04T05:21:52.222Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management NATS backend: write lease has a fixed 30s TTL, no renewal, and compares wall clocks across machines (nats-backend.mjs:686)"
epic: "EP-026"
acceptance: [{"text":"The lease renews, and takeover does not rely on the holder's wall clock","done":false},{"text":"A test fails without the fix","done":false}]
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
updated: "2026-10-04T05:21:52.231Z"
---

From the high-effort code review of PR #179 (2026-10-04). Mutual exclusion breaks on a slow critical section or clock skew. Verify the claim first-hand before fixing.