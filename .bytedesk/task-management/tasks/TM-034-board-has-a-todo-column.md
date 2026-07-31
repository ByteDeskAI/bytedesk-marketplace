---
id: "TM-034"
kind: "task"
status: "done"
created: "2026-07-30T21:01:29.600Z"
title: "Backlog and ToDo columns on the board"
epic: "EP-003"
acceptance: [{"text":"The column of open tasks is labelled ToDo — open IS todo, there is no separate status","done":true,"at":"2026-07-31T01:55:53.353Z"},{"text":"A backlog column holds future work, distinct from ToDo","done":true,"at":"2026-07-31T01:55:53.432Z"},{"text":"A task moves between backlog and ToDo by drag and from the CLI","done":true,"at":"2026-07-31T01:55:53.512Z"},{"text":"The status survives a reload and appears in `tm board`","done":true,"at":"2026-07-31T01:55:53.576Z"}]
evidence: [".bytedesk/task-management/evidence/TM-034-render.mjs",".bytedesk/task-management/evidence/TM-034-keys.mjs"]
commits: ["f446056"]
blockedBy: []
blocks: ["TM-037","TM-038"]
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T01:59:51.870Z"
touches: ["task-management/bin/tm","task-management/dashboard/src/collapsed.ts"]
closed: "2026-07-31T01:55:56.520Z"
---

## Problem
The board calls its first column Open, which says where a task is not rather than what it is
waiting for. Work that is real but not yet queued has nowhere to sit, so it is indistinguishable
from work that is next up.

## Proposal
Backlog → ToDo → In Progress → Done. The existing `open` status is renamed in the UI to ToDo:
it already means "on the list, nobody has started it", which is what ToDo means. Backlog is the
new column, for work that is real but not yet queued. No new status between open and in
progress — the earlier plan added one, and two words for the same state is worse than none.
