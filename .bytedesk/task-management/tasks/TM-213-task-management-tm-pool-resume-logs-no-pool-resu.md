---
id: "TM-213"
kind: "task"
status: "open"
created: "2026-09-23T22:21:44.791Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: 'tm pool resume' logs no pool_resumed event, so dispatch downtime cannot be measured"
epic: "EP-021"
acceptance: [{"text":"Resuming a paused pool logs pool_resumed with the prior pausedReason, pausedAt and failures count.","done":false},{"text":"Resuming a pool that is not paused logs nothing, or an event marked as a no-op.","done":false},{"text":"A test checks the event through the 'tm pool resume' command, not only the library function.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:task-management"]
triagedBy: "auto"
updated: "2026-09-23T22:21:51.160Z"
---

Pauses log pool_paused (lib/dispatch/pool.mjs:287); resumePool (pool.mjs:258-264) and its CLI caller (bin/tm:1458) only write the state file. Observer b3004241 had to retract a '20 minutes' resume figure on 2026-09-17 because no resume record exists. Verified by reading at c895936.