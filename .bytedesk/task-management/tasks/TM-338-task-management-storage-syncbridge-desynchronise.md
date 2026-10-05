---
id: "TM-338"
kind: "task"
status: "open"
created: "2026-10-04T05:21:50.568Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: storage syncbridge desynchronises every later call after one timeout (syncbridge.mjs:32)"
epic: "EP-026"
acceptance: [{"text":"A late reply is discarded and later calls get their own answers","done":false},{"text":"A test fails without the fix","done":false}]
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
updated: "2026-10-04T05:21:50.578Z"
---

From the high-effort code review of PR #179 (2026-10-04). Verified in code: call() throws on timeout without draining the reply or resetting the signal. Verify the claim first-hand before fixing.