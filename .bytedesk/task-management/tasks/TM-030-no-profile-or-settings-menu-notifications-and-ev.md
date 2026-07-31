---
id: "TM-030"
kind: "task"
status: "done"
created: "2026-07-30T18:08:06.548Z"
title: "No profile or settings menu — notifications and every other preference have nowhere to live"
epic: "EP-002"
acceptance: [{"text":"a settings menu holds notification preferences and every other board preference","done":true,"at":"2026-07-30T18:32:36.137Z"},{"text":"settings persist per repo, not per browser","done":true,"at":"2026-07-30T18:32:36.187Z"},{"text":"a profile menu shows who the board thinks you are","done":true,"at":"2026-07-30T18:32:36.237Z"}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/81"]
blockedBy: []
blocks: ["TM-028","TM-029"]
actor: "main"
session: "55951e93-6838-4974-8033-11461bdd2dc4"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-30T18:32:36.352Z"
type: "story"
priority: "highest"
labels: ["ui"]
comments: [{"author":"main","ts":"2026-07-30T18:08:19.051Z","text":"Raised together: settings live per browser today (localStorage), which is why notifications have to be re-enabled everywhere. Persisting them in the store makes them per repo and shared, which is the same move the saved views need."}]
rank: 2468.75
closed: "2026-07-30T18:32:36.351Z"
---

