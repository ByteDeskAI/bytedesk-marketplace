---
id: "TM-422"
kind: "task"
status: "open"
created: "2026-10-05T14:40:50.286Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: governed completion grant waivers for plan-granted landings and unreviewable merged tasks (TM-247 AC9)"
epic: "EP-028"
acceptance: [{"text":"A plan grant covering the landing lets governedCompletion close the task, recording the grant id","done":false},{"text":"A merged task with an unproducible review closes only with an explicit recorded waiver naming the reason","done":false},{"text":"An agent-asserted waiver with no grant record is refused (test)","done":false}]
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
updated: "2026-10-05T14:40:50.293Z"
---

Split from TM-247 (PR #215). Two grant paths need a waiver inside tm's governedCompletion, a security boundary: (1) a plan grant (TM-248) covering a landing whose head differs from the reviewed diff beyond a merge-in; (2) a merged task whose review could never be produced (TM-466 incident). Design the waiver so only a recorded operator/plan grant can satisfy it, never an agent assertion.