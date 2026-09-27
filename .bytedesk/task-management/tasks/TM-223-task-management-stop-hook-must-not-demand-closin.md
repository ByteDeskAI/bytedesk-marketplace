---
id: "TM-223"
kind: "task"
status: "open"
created: "2026-09-24T20:52:51.591Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: stop hook must not demand closing governed tasks with a live worker"
epic: "EP-021"
acceptance: [{"text":"Stop hook stays silent (or informational, non-blocking) for governed in-progress tasks with a live admission record","done":false},{"text":"Ungoverned in_progress tasks still trigger the blocking nudge; tests for both","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "1b07de2e-6b73-47c6-ad14-aa29eeea67fd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-24T20:52:51.598Z"
---

2026-09-24: the gateway's standing lead (d60f0608) is told on every turn end to done/block/park TM-444, which is correctly in_progress: admitted via ao-topology manage admit and actively built by a worker in its own worktree. The hook's advice would misstate live work and desync the governed admission record. A standing lead does not end its session when a turn ends. Fix: skip (or downgrade to an informational note) tasks with governance metadata whose management record state is working and whose worktree/worker is live; keep the nudge for ungoverned tasks the session itself was working on.