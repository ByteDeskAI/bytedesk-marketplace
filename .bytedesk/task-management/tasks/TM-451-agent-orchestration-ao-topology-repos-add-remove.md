---
id: "TM-451"
kind: "task"
status: "open"
created: "2026-10-05T15:37:52.097Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: ao-topology repos add/remove is not refused in a dispatched worker"
epic: "EP-028"
acceptance: [{"text":"repos add and remove exit non-zero with TM_DISPATCH_WORKER set and repos.json is unchanged","done":false},{"text":"repos list still works there","done":false},{"text":"Both use the same worker predicate as services; a test covers it","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:37:53.709Z"
priority: "high"
---

rv-216 on #208, reproduced: with TM_DISPATCH_WORKER=1, 'ao-topology repos remove <operator repo>' exits 0 and empties repos.json; services ensure|restart|stop and manage already refuse (src/services/cli.mjs:81). Rule 3.