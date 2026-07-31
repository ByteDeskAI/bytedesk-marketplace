---
id: "TM-001"
kind: "task"
status: "done"
created: "2026-07-29T22:58:46.242Z"
title: "A crashed write leaves a phantom task that reads, accepts edits, and doctor calls clean"
epic: "EP-001"
acceptance: [{"text":"fileFor never resolves an id to a non-.md file","done":true,"at":"2026-07-29T23:05:28.760Z"},{"text":"writeAtomic's temp name cannot be mistaken for an entity of that id","done":true,"at":"2026-07-29T23:05:28.801Z"},{"text":"tm doctor reports a stray temp file, without deleting anything","done":true,"at":"2026-07-29T23:05:28.833Z"},{"text":"a phantom cannot be shown, started, commented on, or held in_progress","done":true,"at":"2026-07-29T23:05:28.868Z"}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/57","pr"]
blockedBy: []
blocks: []
actor: "main"
branch: "fix/tm-phantom-temp"
worktree: "/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-persona/55951e93-6838-4974-8033-11461bdd2dc4/scratchpad/wt-phantom"
updated: "2026-07-31T03:40:07.135Z"
closed: "2026-07-29T23:05:28.905Z"
---

