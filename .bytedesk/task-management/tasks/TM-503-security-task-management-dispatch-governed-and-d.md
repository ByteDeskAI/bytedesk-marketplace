---
id: "TM-503"
kind: "task"
status: "open"
created: "2026-10-09T02:19:07.221Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY task-management: dispatch.governed and dispatch.integrationBranch are still read from repo config"
epic: "EP-028"
acceptance: [{"text":"Both read through trustedDispatch(), or the repo may only choose the safer value","done":false},{"text":"Tests for both keys","done":false}]
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
updated: "2026-10-09T02:19:08.135Z"
priority: "medium"
links: [{"type":"relates to","id":"TM-467"}]
---

From PR #240 review (rv-240). dispatch.governed=false disables independent review and dispatch.integrationBranch chooses the PR base the worker guard allows; both come from repo-tracked config.