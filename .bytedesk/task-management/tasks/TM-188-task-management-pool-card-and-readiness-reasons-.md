---
id: "TM-188"
kind: "task"
status: "done"
created: "2026-09-12T02:07:17.535Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: pool card and readiness reasons on the dashboard"
epic: "EP-021"
acceptance: [{"text":"a pool card shows running or paused with its reason, workers against poolWip, and the ready count, from GET /api/pool","done":true,"at":"2026-09-13T21:58:43.735Z"},{"text":"the card toggles dispatch.enabled through POST /api/settings, and the pool starts or stops within one poll","done":true,"at":"2026-09-13T21:58:43.819Z"},{"text":"a task card and the task inspector show the readiness verdict and, when not ready, the missing items","done":true,"at":"2026-09-13T21:58:43.898Z"},{"text":"npm run build and npm run typecheck pass in task-management/dashboard, and the committed dist bundle is rebuilt","done":true,"at":"2026-09-13T21:58:44.012Z"},{"text":"verified through agent-browser against a live tm-dashboard, with a screenshot in the evidence","done":true,"at":"2026-09-13T21:58:44.127Z"}]
evidence: [".bytedesk/task-management/evidence/TM-188-VERIFY.md",".bytedesk/task-management/evidence/TM-188-pool-card-running.png",".bytedesk/task-management/evidence/TM-188-pool-card-paused.png",".bytedesk/task-management/evidence/TM-188-card-readiness.png",".bytedesk/task-management/evidence/TM-188-inspector-readiness.png"]
commits: ["666682d","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/118","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/119"]
blockedBy: []
blocks: []
actor: "pool"
session: "pool-tm-188"
branch: "tm/TM-188-task-management-pool-card-and-readiness-reasons-"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-188-task-management-pool-card-and-readiness-reasons-"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-13T22:07:22.114Z"
dispatched: {"backend":"tmux","run":"tmux:tm-TM-188","session":"pool-tm-188","at":"2026-09-13T21:30:17.521Z"}
touches: ["task-management/dashboard/src/features/sessions/PoolCard.tsx"]
evidenceSources: {".bytedesk/task-management/evidence/TM-188-VERIFY.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-188-task-management-pool-card-and-readiness-reasons-/.bytedesk/task-management/evidence/TM-188-VERIFY.md","sha256":"631bb0a918ef18e0b07783f84a82fe77aaae58102ae85460c94e6df58e63af5d","bytes":6864,"at":"2026-09-13T21:58:39.852Z"},".bytedesk/task-management/evidence/TM-188-pool-card-running.png":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-188-task-management-pool-card-and-readiness-reasons-/.bytedesk/task-management/evidence/TM-188-pool-card-running.png","sha256":"915c8cc2a4173e1fb05c7c25e708994fac65d3587c4fbb07b404ce1bdfef540d","bytes":112563,"at":"2026-09-13T21:58:39.959Z"},".bytedesk/task-management/evidence/TM-188-pool-card-paused.png":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-188-task-management-pool-card-and-readiness-reasons-/.bytedesk/task-management/evidence/TM-188-pool-card-paused.png","sha256":"2f7abc6ecd7b21c261cc5b1db6ace335e8f3f8cd2094adf350a429493f51b403","bytes":117073,"at":"2026-09-13T21:58:40.079Z"},".bytedesk/task-management/evidence/TM-188-card-readiness.png":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-188-task-management-pool-card-and-readiness-reasons-/.bytedesk/task-management/evidence/TM-188-card-readiness.png","sha256":"d5eb38b6c20f2060ce03c0beb62e4d555ae31f3232282f5c706c9744e16d1872","bytes":88380,"at":"2026-09-13T21:58:40.164Z"},".bytedesk/task-management/evidence/TM-188-inspector-readiness.png":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-188-task-management-pool-card-and-readiness-reasons-/.bytedesk/task-management/evidence/TM-188-inspector-readiness.png","sha256":"31a8fd328f7f9a3c1a09a895fc9a387ebc2b4708b321d16b199ab1bfad89f435","bytes":121241,"at":"2026-09-13T21:58:40.278Z"}}
comments: [{"author":"@pool","ts":"2026-09-13T22:00:48.895Z","text":"PR #118 opened from tm/TM-188-…, commit 666682d. Two items flagged for human review in the PR: a narrow .gitignore exception so evidence screenshots reach a clone, and a pre-existing inspector scroll bug (reproduced on the unmodified dashboard) that hides everything below the fold. The 14 unit failures on this branch are the same 14 as on edd9a93 in a clean worktree, line for line."}]
closed: "2026-09-13T22:00:48.985Z"
---

Split out of TM-179, which shipped the CLI and HTTP halves (tm why readiness, GET /api/pool from the shared poolStatus). The React surface was deferred because task-management/dashboard builds from the private npm registry (@bytedesk/design-tokens, @bytedesk/design-ui) and has no node_modules in this checkout, so it cannot be built or verified without registry credentials. Add a pool card reading GET /api/pool (running or paused with reason, workers against poolWip, ready count, idle-exit and log path) with an enable toggle through the existing POST /api/settings, and show each task's readiness verdict on its card and in the inspector from the why payload's readiness field.