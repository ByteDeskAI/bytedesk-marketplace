---
id: "TM-031"
kind: "task"
status: "done"
created: "2026-07-30T18:21:17.058Z"
title: "The card title is a div with onClick — not focusable, not announced, not clickable by automation"
epic: "EP-002"
acceptance: []
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/84"]
blockedBy: []
blocks: []
actor: "main"
session: "55951e93-6838-4974-8033-11461bdd2dc4"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-30T18:55:02.731Z"
type: "bug"
priority: "high"
labels: ["ui","a11y"]
comments: [{"author":"main","ts":"2026-07-30T18:21:43.610Z","text":"Found with agent-browser: it could not click the card title at all, because the element is a <div> with cursor:pointer and an onClick — no role, no tabindex. Tab never reaches it and screen readers do not announce it. @atlaskit/primitives ships Pressable, which is the fix."}]
closed: "2026-07-30T18:55:02.730Z"
---

