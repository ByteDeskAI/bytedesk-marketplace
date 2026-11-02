---
id: "TM-418"
kind: "task"
status: "done"
created: "2026-10-05T14:25:10.442Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: automatic review requests carry the worker's check evidence"
epic: "EP-028"
acceptance: [{"text":"A worker finish report records the checks it ran with exit code and revision","done":true,"at":"2026-10-05T15:27:55.086Z"},{"text":"Automatic review requests (finish report, review sweep) attach that evidence","done":true,"at":"2026-10-05T15:27:55.543Z"},{"text":"With evidence for every required check the reviewer can approve; a test covers the automatic path","done":true,"at":"2026-10-05T15:27:56.010Z"}]
evidence: [".bytedesk/task-management/evidence/TM-418-1791214076503.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/219","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/234"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T01:25:03.508Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-418-1791214076503.log":{"source":null,"sha256":"765a7b8fb91439fb0b84982a2a23b0411c7662eed0844dcf9c4a1806ef86513a","bytes":368,"at":"2026-10-05T15:27:56.504Z"}}
closed: "2026-10-05T15:27:56.958Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:28:59.772Z","text":"review-sweep: TM-418 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:50:23.459Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/219 (independent post-merge review rv-gov; note: worker evidence handled by TM-430)"}]
---

From TM-216 (PR #210): required_checks now need revision-bound evidence, but review requests filed automatically (supervisor review sweep, worker finish report) carry none, so the reviewer can only return blocked until a lead re-requests with --checks. That stalls the autonomy path (TM-368). The worker's finish report should record the checks it ran (command, exit, revision) and the request should attach them.