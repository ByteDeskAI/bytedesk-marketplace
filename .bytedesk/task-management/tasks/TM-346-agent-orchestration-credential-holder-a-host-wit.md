---
id: "TM-346"
kind: "task"
status: "open"
created: "2026-10-04T05:21:54.989Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration credential holder: a host without ss refuses every request with a misleading error (agent-creds.mjs:247)"
epic: "EP-026"
acceptance: [{"text":"Provisioning checks for ss and fails with a named error; peer lookup does not block the event loop","done":false},{"text":"A test fails without the fix","done":false}]
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
updated: "2026-10-04T05:21:54.996Z"
---

From the high-effort code review of PR #179 (2026-10-04). Provisioning succeeds but every agent is then unusable. Verify the claim first-hand before fixing.