---
id: "TM-504"
kind: "task"
status: "open"
created: "2026-10-09T02:19:09.237Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management dashboard token: residual LOW exposures from PR #240 review"
epic: "EP-028"
acceptance: [{"text":"launchBrowser never puts the token in argv","done":false},{"text":"Transcript exposure and board-claim --steal documented in the ADR/README","done":false}]
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
updated: "2026-10-09T02:19:10.285Z"
priority: "low"
links: [{"type":"relates to","id":"TM-467"}]
---

From rv-240: (a) launchBrowser passes the token URL in xdg-open argv (/proc cmdline) — open a 0600 redirect file instead; (b) 'already running …#tm-token=' line reaches agent transcripts — document under ADR one-user-one-trust-domain; (c) board claims belong to tm-dashboard, lead needs --steal — document or give board claims a short TTL.