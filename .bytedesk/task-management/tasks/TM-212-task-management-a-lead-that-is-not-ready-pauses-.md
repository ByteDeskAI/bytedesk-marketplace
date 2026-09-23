---
id: "TM-212"
kind: "task"
status: "open"
created: "2026-09-23T22:21:44.621Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: a lead that is not ready pauses the whole pool instead of holding one tick"
epic: "EP-021"
acceptance: [{"text":"Three TOPOLOGY_STARTUP_NOT_READY results with maxFailures 3 leave failures at 0 and the pool not paused.","done":false},{"text":"The tick's skipped entry names the readiness-hold reason, and the task is retried on a later tick.","done":false},{"text":"A unit test in pool-safety.test.mjs fails if the code is moved back under provider scope.","done":false}]
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
updated: "2026-09-23T22:21:51.033Z"
---

Observer b3004241 reported three pool pauses on 2026-09-17; the third (TM-386, 11:07Z) followed a 69s lead flap. Verified 2026-09-23 at c895936: the poison-task half was fixed in c0a66d6 (failure scopes; pool-safety.test.mjs 21/21), but lib/dispatch/failure.mjs:6 classes TOPOLOGY_STARTUP_NOT_READY as provider scope, so it counts toward dispatch.maxFailures (pool.mjs:280) and three in a row pause dispatch until someone runs tm pool resume (pool.mjs:291). A briefly mid-turn lead is a readiness hold, not a provider failure. Related: TM-210 decides what governed launch itself should do against a busy lead.