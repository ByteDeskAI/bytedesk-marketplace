---
id: "TM-501"
kind: "task"
status: "open"
created: "2026-10-09T02:19:03.234Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY agent-orchestration: repo-tracked agents/<id>/session.sh and session.json choose the command a gateway restore runs"
epic: "EP-028"
acceptance: [{"text":"session.sh, session.json and prompt state under agents/ are gitignored and removed from the index","done":false},{"text":"agent.json cli/args/env follow the providerDirs trust rule (user config or plugin defaults only); test proves a repo-written value is ignored","done":false}]
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
updated: "2026-10-09T02:19:04.206Z"
priority: "high"
links: [{"type":"relates to","id":"TM-467"}]
---

From PR #240 review (rv-240). .bytedesk/agent-orchestration/agents/<id>/{agent.json,session.json,session.sh} are committed and set cli/args/env and the restore command for lead/reviewer/observer sessions (launch.mjs:1505 runs session.json command = bash session.sh). A merged PR editing session.sh runs as the observer on next restore. Four such files are committed in this repo.