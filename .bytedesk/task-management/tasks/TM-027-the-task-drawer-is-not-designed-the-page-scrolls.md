---
id: "TM-027"
kind: "task"
status: "done"
created: "2026-07-30T17:35:59.632Z"
title: "The task drawer is not designed: the page scrolls behind it, and it is a flat wall of controls"
epic: "EP-002"
acceptance: [{"text":"the drawer's own content scrolls; the board behind it does not move when you scroll over the drawer","done":true,"at":"2026-07-30T17:48:27.174Z"},{"text":"every section is reachable on a dense task — nothing is stranded below the fold","done":true,"at":"2026-07-30T17:48:27.231Z"},{"text":"the task id, title and status stay visible while the body scrolls","done":true,"at":"2026-07-30T17:48:27.277Z"},{"text":"the content is grouped so a reader can find one thing without scanning all of it","done":true,"at":"2026-07-30T17:48:27.329Z"},{"text":"verified in the browser at a short viewport, not only by reading the diff","done":true,"at":"2026-07-30T17:48:27.380Z"}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/79"]
blockedBy: []
blocks: []
actor: "main"
session: "55951e93-6838-4974-8033-11461bdd2dc4"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-30T17:48:27.490Z"
type: "story"
priority: "highest"
rank: 2468.75
labels: ["ui"]
comments: [{"author":"main","ts":"2026-07-30T17:38:26.996Z","text":"Measured before designing: panel clientHeight 812, scrollHeight 1022 — 210px unreachable. The only scrollable element on the page is OUTSIDE the panel (scrollableIsInsidePanel:false), so scrolling over the drawer moves the board behind it. The whole COMMENTS section — 3 comments plus the add field — is stranded below the fold on a task with 5 acceptance criteria."}]
closed: "2026-07-30T17:48:27.490Z"
---

