---
id: "TM-064"
kind: "task"
status: "done"
created: "2026-09-02T06:55:56.184Z"
board: "bytedeskai/bytedesk-marketplace"
title: "tm dispatch verb + tm_dispatch MCP tool + dispatch API route"
epic: "EP-007"
acceptance: [{"text":"single code path lib/dispatch/index.mjs drives CLI tm dispatch, MCP tm_dispatch, and POST /api/task/:id/dispatch with identical refusal wording","done":true,"at":"2026-09-02T08:51:01.887Z"},{"text":"dispatch respects gates (WIP, claim) and records {dispatched:{backend,run,session,at}} on the task plus a dispatched event","done":true,"at":"2026-09-02T08:51:01.990Z"},{"text":"re-dispatch refuses while a live claim is held","done":true,"at":"2026-09-02T08:51:02.094Z"},{"text":"MCP tool-count assertion updated; dispatched event added three-place (ntfy CATALOG + log-render fixture + tests)","done":true,"at":"2026-09-02T08:51:02.191Z"}]
evidence: [".bytedesk/task-management/evidence/TM-064-waveC-full.log",".bytedesk/task-management/evidence/TM-064-tm064.log"]
commits: []
blockedBy: ["TM-063"]
blocks: ["TM-065","TM-068"]
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T08:51:03.817Z"
touches: ["task-management/bin/tm","task-management/lib/dashboard-api.mjs","task-management/lib/dispatch/index.mjs","task-management/lib/mcp.mjs","task-management/lib/ntfy.mjs"]
closed: "2026-09-02T08:51:03.813Z"
---

