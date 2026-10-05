---
id: "TM-246"
kind: "task"
status: "open"
created: "2026-09-25T17:51:21.103Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: a dispatched worker hands its task to background agents, ends its turn, and the work dies with the session"
epic: "EP-021"
acceptance: [{"text":"The dispatched-worker handoff states that the worker must do the task in its own session, must not end its turn while any background agent or command it started is still running, and must never ask a question expecting an answer (block with the question instead via tm block).","done":false},{"text":"When a dispatched worker's session exits with uncommitted changes in its worktree, collect records the dirty paths in the failure reason instead of only 'worker exited without closing'.","done":false},{"text":"A render test asserts the handoff carries those rules; a collect test asserts the dirty-path reason.","done":false}]
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
updated: "2026-09-25T17:51:21.385Z"
priority: "high"
---

Seen 2026-09-25 on TM-240 (and partly TM-242). The dispatched worker decided the task was large, launched a background subagent to implement it, and ended its turn saying it would wait for the completion notification. The worker session then ended, the background agents with it, and collect recorded 'worker exited without closing': TM-240 was parked with 4 uncommitted files and no commit. TM-242's worker also spawned a background agent before asking a question nobody could answer. A dispatched worker has no human and no later turn: ending the turn ends the work. The handoff (task-management/lib/render.mjs) does not say so.