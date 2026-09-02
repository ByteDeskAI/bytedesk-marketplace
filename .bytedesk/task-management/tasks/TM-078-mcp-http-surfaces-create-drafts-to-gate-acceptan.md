---
id: "TM-078"
kind: "task"
status: "done"
created: "2026-09-02T11:49:49.408Z"
board: "bytedeskai/bytedesk-marketplace"
title: "MCP + HTTP surfaces: create drafts to gate, acceptance-without-template fix"
epic: "EP-011"
acceptance: [{"text":"both surfaces refuse sparse creates and name the missing fields","done":true,"at":"2026-09-02T12:40:41.976Z"},{"text":"acceptance payload honored without template (regression pinned)","done":true,"at":"2026-09-02T12:40:42.098Z"},{"text":"mcp/dispatch-surfaces unit 41 pass, test-mcp.sh 77, test-dashboard.sh 184","done":true,"at":"2026-09-02T12:40:42.206Z"}]
evidence: [".bytedesk/task-management/evidence/TM-078-tm-076-080-suite.log"]
commits: []
blockedBy: []
blocks: []
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T12:40:53.982Z"
closed: "2026-09-02T12:40:53.978Z"
---

MCP tm_task_create and HTTP POST /api/task pass drafts to gateTaskCreate (error envelope / 409 naming missing fields); tool description teaches body+acceptance; fixed the acceptance-payload-dropped-without-template bug via normalizeAcceptance applied always.