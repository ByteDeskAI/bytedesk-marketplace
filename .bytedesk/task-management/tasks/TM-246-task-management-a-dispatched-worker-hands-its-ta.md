---
id: "TM-246"
kind: "task"
status: "done"
created: "2026-09-25T17:51:21.103Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: a dispatched worker hands its task to background agents, ends its turn, and the work dies with the session"
epic: "EP-028"
acceptance: [{"text":"The dispatched-worker handoff states that the worker must do the task in its own session, must not end its turn while any background agent or command it started is still running, and must never ask a question expecting an answer (block with the question instead via tm block).","done":true,"at":"2026-10-05T15:27:22.376Z"},{"text":"When a dispatched worker's session exits with uncommitted changes in its worktree, collect records the dirty paths in the failure reason instead of only 'worker exited without closing'.","done":true,"at":"2026-10-05T15:27:22.827Z"},{"text":"A render test asserts the handoff carries those rules; a collect test asserts the dirty-path reason.","done":true,"at":"2026-10-05T15:27:23.280Z"}]
evidence: [".bytedesk/task-management/evidence/TM-246-1791214043660.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/209","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-3"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:task-management"]
triagedBy: "auto"
updated: "2026-10-05T15:37:56.109Z"
priority: "high"
evidenceSources: {".bytedesk/task-management/evidence/TM-246-1791214043660.log":{"source":null,"sha256":"8c4322d3c3bc5eac84cb7f771f133bd2f1264ea52f19db800a76539bb7810f45","bytes":368,"at":"2026-10-05T15:27:23.661Z"}}
closed: "2026-10-05T15:27:24.163Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:28:55.204Z","text":"review-sweep: TM-246 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:37:56.104Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/209 (independent post-merge review rv-216; TM-246 met; TM-244 fix TM-437)"}]
---

Seen 2026-09-25 on TM-240 (and partly TM-242). The dispatched worker decided the task was large, launched a background subagent to implement it, and ended its turn saying it would wait for the completion notification. The worker session then ended, the background agents with it, and collect recorded 'worker exited without closing': TM-240 was parked with 4 uncommitted files and no commit. TM-242's worker also spawned a background agent before asking a question nobody could answer. A dispatched worker has no human and no later turn: ending the turn ends the work. The handoff (task-management/lib/render.mjs) does not say so.