---
id: "TM-343"
kind: "task"
status: "open"
created: "2026-10-04T05:21:53.366Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: every journal append waits up to 1.5s on the ORCH_EVENTS mirror and may use the wrong transport (mailbox.mjs:81)"
epic: "EP-026"
acceptance: [{"text":"A slow NATS adds no more than one bounded delay per run; the mirror uses the right transport","done":false},{"text":"A test fails without the fix","done":false}]
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
updated: "2026-10-04T05:21:53.375Z"
---

From the high-effort code review of PR #179 (2026-10-04). A slow NATS stalls launch and wait by tens of seconds. Verify the claim first-hand before fixing.