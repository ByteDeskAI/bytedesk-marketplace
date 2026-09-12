---
id: "TM-188"
kind: "task"
status: "open"
created: "2026-09-12T02:07:17.535Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: pool card and readiness reasons on the dashboard"
epic: "EP-021"
acceptance: [{"text":"a pool card shows running or paused with its reason, workers against poolWip, and the ready count, from GET /api/pool","done":false},{"text":"the card toggles dispatch.enabled through POST /api/settings, and the pool starts or stops within one poll","done":false},{"text":"a task card and the task inspector show the readiness verdict and, when not ready, the missing items","done":false},{"text":"npm run build and npm run typecheck pass in task-management/dashboard, and the committed dist bundle is rebuilt","done":false},{"text":"verified through agent-browser against a live tm-dashboard, with a screenshot in the evidence","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "c3738e82-1fbf-4fc3-a6a3-06f965eac51c"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-12T02:07:17.542Z"
---

Split out of TM-179, which shipped the CLI and HTTP halves (tm why readiness, GET /api/pool from the shared poolStatus). The React surface was deferred because task-management/dashboard builds from the private npm registry (@bytedesk/design-tokens, @bytedesk/design-ui) and has no node_modules in this checkout, so it cannot be built or verified without registry credentials. Add a pool card reading GET /api/pool (running or paused with reason, workers against poolWip, ready count, idle-exit and log path) with an enable toggle through the existing POST /api/settings, and show each task's readiness verdict on its card and in the inspector from the why payload's readiness field.