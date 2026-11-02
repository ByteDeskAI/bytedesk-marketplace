---
id: "TM-489"
kind: "task"
status: "open"
created: "2026-10-08T23:48:19.336Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY workers use a GitHub credential that cannot merge or push to protected branches"
epic: "EP-028"
acceptance: [{"text":"Dispatched workers receive a GitHub credential with no merge/admin permission (verified: gh pr merge as the worker fails server-side)","done":false},{"text":"main and the integration branches require PR + passing checks for everyone except the release identity","done":false},{"text":"Documented in the runbook with how the lead/landing identity merges","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-human"]
triagedBy: "human"
updated: "2026-10-08T23:48:19.691Z"
priority: "highest"
---

rv-230 on #230: any client-side worker guard is bypassable by a same-UID worker (expansions, interpreters, xargs, retargeting via gh config/remotes, setsid escapes). The real control is server-side: dispatched workers authenticate to GitHub with a token (fine-grained PAT or GitHub App installation token) scoped to push their own branches and open PRs, with no merge or admin rights, and main/develop protected by branch rules. Needs Ryan: org settings and token issuance.