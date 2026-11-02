---
id: "TM-398"
kind: "task"
status: "open"
created: "2026-10-05T12:32:01.890Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration lead startup: verify and close stale in_progress tasks, attribute a dirty tree, file plugin-config blockers upstream"
epic: "EP-028"
acceptance: [{"text":"Lead start verifies stale in_progress tasks against commit evidence and closes or parks each with a reason","done":false},{"text":"Lead start attributes uncommitted files to tasks or lists exactly which are unowned","done":false},{"text":"The lead role prompt instructs filing plugin-owned config blockers upstream, then plugin-rsync and continue","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T12:32:01.899Z"
---

Split from TM-392 (AC5, AC6), reported from the agent-fabric lead session 2026-10-05: on start, a lead found TM-013 stale in_progress with 0/3 ACs although commit ca13503 appears to deliver it, plus unowned uncommitted edits. Wanted: at lead start, verify commit evidence for stale in_progress tasks and close or park them with a reason; attribute a dirty working tree to tasks or report exactly which files are unowned; the lead role prompt says to file plugin-owned config blockers with that plugin's lead (ao-topology upstream file once TM-383 lands), then run plugin-rsync after the fix and continue.