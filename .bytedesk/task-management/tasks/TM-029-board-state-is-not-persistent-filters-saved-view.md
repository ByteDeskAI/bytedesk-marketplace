---
id: "TM-029"
kind: "task"
status: "done"
created: "2026-07-30T18:08:06.485Z"
title: "Board state is not persistent: filters, saved views and preferences do not survive"
epic: "EP-002"
acceptance: [{"text":"filters and saved views survive a reload","done":true,"at":"2026-07-30T19:02:31.906Z"}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/86"]
blockedBy: ["TM-030"]
blocks: []
actor: "main"
session: "55951e93-6838-4974-8033-11461bdd2dc4"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-30T19:02:32.016Z"
type: "bug"
priority: "high"
labels: ["ui"]
comments: [{"author":"main","ts":"2026-07-30T18:33:27.914Z","text":"Partly delivered by #81: the grouped toggle now persists per repo. Still outstanding — saved views and the active filter set are both still localStorage (dashboard/src/filters.ts), and 'views' is already in the settings allowlist waiting for them."}]
closed: "2026-07-30T19:02:32.015Z"
---

