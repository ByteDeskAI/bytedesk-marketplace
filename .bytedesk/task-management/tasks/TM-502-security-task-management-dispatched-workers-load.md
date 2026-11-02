---
id: "TM-502"
kind: "task"
status: "open"
created: "2026-10-09T02:19:05.268Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY task-management: dispatched workers load the repo's .claude/settings.json hooks and .mcp.json"
epic: "EP-028"
acceptance: [{"text":"DEFAULT_COMMAND adds --setting-sources user --strict-mcp-config","done":false},{"text":"Test proves a project SessionStart hook does not run in a dispatched worker while the worker guard still loads","done":false}]
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
updated: "2026-10-09T02:19:06.153Z"
priority: "high"
links: [{"type":"relates to","id":"TM-467"}]
---

From PR #240 review (rv-240). Workers run claude -p --dangerously-skip-permissions in a repo worktree, so project hooks and MCP servers load into every worker; a merged PR can add a SessionStart hook that every later worker runs. The worker guard is passed via --settings (tmux.mjs:228), so restricting sources keeps it.