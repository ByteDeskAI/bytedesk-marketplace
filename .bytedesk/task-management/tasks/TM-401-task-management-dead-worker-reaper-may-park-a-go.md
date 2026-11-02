---
id: "TM-401"
kind: "task"
status: "open"
created: "2026-10-05T12:49:17.700Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: dead-worker reaper may park a governed task between manage rework and the next dispatch"
epic: "EP-028"
acceptance: [{"text":"A test reproduces rework followed by a reaper pass with a dead old worker row; the task stays working with its claim","done":false},{"text":"The reaper's skip rule is shared with any sibling reaper path","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T12:49:17.709Z"
---

Follow-up from TM-347 (PR for TM-347..349): after 'manage rework' sets governance back to working and clears dispatched, the tm dead-worker reaper may see the old worker's dead registry row and park the task, releasing its claim before the next dispatch. Verify and, if real, make the reaper skip governed tasks whose latest event is rework.