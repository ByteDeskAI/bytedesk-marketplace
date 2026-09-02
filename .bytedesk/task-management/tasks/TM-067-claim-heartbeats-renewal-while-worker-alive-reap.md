---
id: "TM-067"
kind: "task"
status: "done"
created: "2026-09-02T06:56:54.462Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Claim heartbeats: renewal while worker alive, reaper for dead agents"
epic: "EP-008"
acceptance: [{"text":"heartbeatClaim(id) refreshes claim ts under withLock; dispatcher heartbeats while its worker is alive","done":true,"at":"2026-09-02T08:51:02.288Z"},{"text":"a heartbeating claim never expires; a dead worker's claim expires on TTL and the reaper parks its task with a reason","done":true,"at":"2026-09-02T08:51:02.393Z"},{"text":"existing claims/expiry/steal pinned tests (claims, mcp-claims, concurrency) untouched and green","done":true,"at":"2026-09-02T08:51:02.491Z"}]
evidence: [".bytedesk/task-management/evidence/TM-067-waveC-full.log",".bytedesk/task-management/evidence/TM-067-tm067.log"]
commits: []
blockedBy: ["TM-066"]
blocks: []
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T08:51:03.942Z"
touches: ["task-management/lib/agents.mjs","task-management/lib/claims.mjs","task-management/tests/unit/heartbeat.test.mjs"]
labels: ["ready-for-agent"]
closed: "2026-09-02T08:51:03.937Z"
---

