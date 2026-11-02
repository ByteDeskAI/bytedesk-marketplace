---
id: "TM-345"
kind: "task"
status: "open"
created: "2026-10-04T05:21:54.464Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management migrate: schema-0 data is stamped schema 1 without running the upcaster (migrate.mjs:52)"
epic: "EP-026"
acceptance: [{"text":"Migrated records pass through the upcaster, tested on a legacy fixture","done":false},{"text":"A test fails without the fix","done":false}]
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
updated: "2026-10-04T05:21:54.472Z"
---

From the high-effort code review of PR #179 (2026-10-04). Migrated tasks can lack labels, kind and comments. Verify the claim first-hand before fixing.