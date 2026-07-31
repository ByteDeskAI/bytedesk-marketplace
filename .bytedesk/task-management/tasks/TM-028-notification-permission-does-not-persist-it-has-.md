---
id: "TM-028"
kind: "task"
status: "done"
created: "2026-07-30T18:08:06.410Z"
title: "Notification permission does not persist — it has to be re-enabled in every browser, every time"
epic: "EP-002"
acceptance: [{"text":"which notifications you want persists per repo, not per browser","done":true,"at":"2026-07-30T18:33:27.683Z"}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/81"]
blockedBy: ["TM-030"]
blocks: []
actor: "main"
session: "55951e93-6838-4974-8033-11461bdd2dc4"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-30T18:33:27.857Z"
type: "bug"
priority: "high"
labels: ["ui"]
comments: [{"author":"main","ts":"2026-07-30T18:33:27.733Z","text":"Delivered by #81: categories, me and watching are written to the repo's config and adopted by any browser opening that board. The browser PERMISSION grant itself cannot follow you — it is granted per origin per browser by the user, and no page can store it on someone else's behalf. The settings modal now says 'not permitted yet' and offers to ask, instead of showing switches that cannot fire. The original criterion asked for something the platform does not allow, so it was reworded to what is achievable."}]
closed: "2026-07-30T18:33:27.856Z"
---

