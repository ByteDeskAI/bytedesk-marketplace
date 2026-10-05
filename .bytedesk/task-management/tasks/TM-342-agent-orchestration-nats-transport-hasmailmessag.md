---
id: "TM-342"
kind: "task"
status: "open"
created: "2026-10-04T05:21:52.777Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration NATS transport: hasMailMessage is refused for workers and answered as not found, so handoff retry duplicates (orch-transport.mjs:917)"
epic: "EP-026"
acceptance: [{"text":"A worker's handoff retry does not send a second successor","done":false},{"text":"A test fails without the fix","done":false}]
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
updated: "2026-10-04T05:21:52.786Z"
---

From the high-effort code review of PR #179 (2026-10-04). Only the lead role may read ORCH_MAIL by sequence; TM-315's guard fails for workers. Verify the claim first-hand before fixing.