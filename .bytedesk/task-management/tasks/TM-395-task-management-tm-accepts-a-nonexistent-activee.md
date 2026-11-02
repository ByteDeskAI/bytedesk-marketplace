---
id: "TM-395"
kind: "task"
status: "open"
created: "2026-10-05T11:30:25.319Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm accepts a nonexistent activeEpic and files new tasks under it"
epic: "EP-028"
acceptance: [{"text":"tm task new refuses, with a named error, when activeEpic names an epic that does not exist, and writes nothing","done":false},{"text":"tm doctor reports a dangling activeEpic and tasks whose epic does not exist","done":false}]
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
updated: "2026-10-05T11:30:25.327Z"
---

2026-10-05: a stray reviewer 'tm epic new' (TM-320 incident) set config.json activeEpic=EP-029; the epic file was then deleted as junk. tm kept assigning EP-029 to new tasks (TM-391..394) while printing 'no such epic: EP-029'. Creating a task under a missing epic should refuse (or fall back to no epic with a warning), not write a dangling reference.