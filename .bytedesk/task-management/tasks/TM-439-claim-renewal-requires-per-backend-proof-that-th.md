---
id: "TM-439"
kind: "task"
status: "open"
created: "2026-10-05T15:34:56.755Z"
board: "bytedeskai/bytedesk-marketplace"
title: "claim renewal requires per-backend proof that the worker process is alive"
epic: "EP-028"
acceptance: [{"text":"An idle dispatch whose agent is dead is not renewed","done":false},{"text":"A dead tmux pane kept by remain-on-exit is not renewed","done":false},{"text":"Tests cover both","done":false}]
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
updated: "2026-10-05T15:34:58.808Z"
priority: "high"
---

Post-merge review of #199 (rv-203). renewIfLive treats collectIdle pending:true (no reply yet) as alive, so a dead standing agent's claim is renewed forever; tmux has-session stays true under remain-on-exit or a leftover tm-<id> session.