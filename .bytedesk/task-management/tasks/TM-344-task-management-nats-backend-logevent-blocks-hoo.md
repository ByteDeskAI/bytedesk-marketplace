---
id: "TM-344"
kind: "task"
status: "open"
created: "2026-10-04T05:21:53.917Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management NATS backend: logEvent blocks hooks on a synchronous bridge call and list fetches keys one by one (store.mjs:568)"
epic: "EP-026"
acceptance: [{"text":"Hook-path event logging is bounded and non-blocking; list is batched","done":false},{"text":"A test fails without the fix","done":false}]
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
updated: "2026-10-04T05:21:53.925Z"
---

From the high-effort code review of PR #179 (2026-10-04). Hook latency scales with board size and a half-dead hub. Verify the claim first-hand before fixing.