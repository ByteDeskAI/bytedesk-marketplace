---
id: "TM-336"
kind: "task"
status: "open"
created: "2026-10-04T05:21:49.427Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: an agent that double-forks out of its tree is treated as the operator and gets the admin seed (agent-creds.mjs:374)"
epic: "EP-026"
acceptance: [{"text":"A reparented descendant is refused the admin seed and holder attach","done":false},{"text":"A test fails without the fix","done":false}]
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
updated: "2026-10-04T05:21:49.436Z"
---

From the high-effort code review of PR #179 (2026-10-04). Same family as TM-332; the docs omit this bypass. Release blocker for EP-026. Verify the claim first-hand before fixing.