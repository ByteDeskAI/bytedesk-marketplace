---
id: "TM-497"
kind: "task"
status: "open"
created: "2026-10-09T02:00:58.693Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management worker-guard: refuse tm goal resume and tm override for workers"
epic: "EP-028"
acceptance: [{"text":"A worker session running tm goal resume or tm override is refused by the worker guard (test)","done":false},{"text":"Uses the shared isWorkerCaller predicate from TM-470","done":false}]
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
updated: "2026-10-09T02:13:32.228Z"
comments: [{"author":"main","ts":"2026-10-09T02:13:32.217Z","text":"rv-236: the worker-guard rule should match the command text 'tm goal resume' (it survives env -u TM_DISPATCH_WORKER)."}]
---

rv-236 on #236: dispatched workers run with --dangerously-skip-permissions, so 'CLI-only, never auto-approved' does not protect tm goal resume (TM-486) or tm override. Add worker-guard rules once PR #230 (which owns worker-guard.mjs) merges; until then goalResume refuses worker env itself.