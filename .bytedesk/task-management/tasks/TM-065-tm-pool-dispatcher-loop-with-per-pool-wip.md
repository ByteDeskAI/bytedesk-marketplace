---
id: "TM-065"
kind: "task"
status: "done"
created: "2026-09-02T06:55:56.295Z"
board: "bytedeskai/bytedesk-marketplace"
title: "tm pool dispatcher loop with per-pool WIP"
epic: "EP-007"
acceptance: [{"text":"tm pool once|start|stop|status dispatches nextTasks ∩ label:ready-for-agent ∩ unclaimed in touches-disjoint batches","done":true,"at":"2026-09-02T09:23:44.671Z"},{"text":"pool stops dispatching at config dispatch.poolWip (default 3), independent of board-global wipLimit","done":true,"at":"2026-09-02T09:23:44.798Z"},{"text":"kill-switches: TM_ENFORCE=off and dispatch.enabled=false; per-machine pid file registered in the store gitignore contract","done":true,"at":"2026-09-02T09:23:44.902Z"},{"text":"contract test with a fake backend proves batching, cap, and kill-switch behavior","done":true,"at":"2026-09-02T09:23:45.011Z"}]
evidence: [".bytedesk/task-management/evidence/TM-065-waveD-full.log",".bytedesk/task-management/evidence/TM-065-tm065.log"]
commits: []
blockedBy: ["TM-064"]
blocks: ["TM-072","TM-073"]
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T09:23:46.490Z"
touches: ["task-management/lib/dispatch/pool.mjs","task-management/monitors/monitors.json","task-management/tests/unit/pool.test.mjs"]
labels: ["ready-for-agent"]
closed: "2026-09-02T09:23:46.487Z"
---

