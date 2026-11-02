---
id: "TM-438"
kind: "task"
status: "open"
created: "2026-10-05T15:34:55.939Z"
board: "bytedeskai/bytedesk-marketplace"
title: "tm claim note caps its TTL; pool skips (not dispatches) a task when the AO assignment check times out"
epic: "EP-028"
acceptance: [{"text":"A claim note TTL above the cap (4h) is refused","done":false},{"text":"When the ao-topology assignment check times out the pool skips the task this tick without dispatching","done":false},{"text":"Tests cover both","done":false}]
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
updated: "2026-10-05T15:34:55.947Z"
---

Post-merge review of #203 (rv-203), LOW items: claim note --ttl is unbounded (99999h silences the Stop gate); live-owner aoAssignment fails open after 15s, letting a second writer start.