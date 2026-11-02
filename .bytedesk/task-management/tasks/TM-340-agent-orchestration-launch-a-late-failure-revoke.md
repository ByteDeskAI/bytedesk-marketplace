---
id: "TM-340"
kind: "task"
status: "open"
created: "2026-10-04T05:21:51.662Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration launch: a late failure revokes every credential holder, including panes already running (launch.mjs:897)"
epic: "EP-026"
acceptance: [{"text":"Only holders for agents that never started are revoked, tested","done":false},{"text":"A test fails without the fix","done":false}]
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
updated: "2026-10-04T05:21:51.671Z"
---

From the high-effort code review of PR #179 (2026-10-04). Kept launch_failed sessions lose their credentials at once. Verify the claim first-hand before fixing.