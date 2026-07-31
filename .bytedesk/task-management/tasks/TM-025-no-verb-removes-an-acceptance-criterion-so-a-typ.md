---
id: "TM-025"
kind: "task"
status: "done"
created: "2026-07-30T17:07:52.242Z"
title: "Acceptance criteria are a one-way door: no untick, no remove, on any surface"
epic: "EP-002"
acceptance: [{"text":"a ticked criterion can be unticked on the CLI, MCP and the board","done":true,"at":"2026-07-30T17:26:56.719Z"},{"text":"a criterion can be removed, and the surviving list is returned because removal renumbers","done":true,"at":"2026-07-30T17:26:56.784Z"}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/78"]
blockedBy: []
blocks: []
actor: "main"
session: "55951e93-6838-4974-8033-11461bdd2dc4"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-30T17:26:56.889Z"
type: "bug"
priority: "highest"
rank: 1625
comments: [{"author":"main","ts":"2026-07-30T17:11:54.512Z","text":"Hit live: the dashboard checkbox ticked a criterion and offered no way back. Unticking required hand-editing the frontmatter JSON. The dashboard can tick (POST /api/task/:id/accept) and the CLI can tick (tm accept) — neither can undo, and nothing can remove a criterion that was a typo."}]
closed: "2026-07-30T17:26:56.888Z"
---

