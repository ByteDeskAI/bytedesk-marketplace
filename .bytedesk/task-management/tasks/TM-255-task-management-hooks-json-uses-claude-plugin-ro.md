---
id: "TM-255"
kind: "task"
status: "open"
created: "2026-09-25T20:39:06.784Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: hooks.json uses ${CLAUDE_PLUGIN_ROOT} unquoted in 15 hook commands"
epic: "EP-021"
acceptance: [{"text":"Every hook command in task-management/hooks/hooks.json quotes ${CLAUDE_PLUGIN_ROOT} paths; claude plugin validate ./task-management shows only the expected 'No version specified' warning.","done":false},{"text":"A test or check fails if an unquoted ${CLAUDE_PLUGIN_ROOT} is reintroduced in hooks.json.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:task-management"]
triagedBy: "auto"
updated: "2026-09-25T20:39:07.137Z"
priority: "low"
---

claude plugin validate ./task-management passes but warns 15 times that hooks/hooks.json uses ${CLAUDE_PLUGIN_ROOT} without quotes (found 2026-09-25 while rebuilding PR 127; present on origin/main, 15 occurrences). An install path containing a space would split the command and break every hook.