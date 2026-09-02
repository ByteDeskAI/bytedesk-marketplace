---
id: "TM-066"
kind: "task"
status: "done"
created: "2026-09-02T06:56:54.346Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Agent registry (lib/agents.mjs, tm agent, tm_agents MCP, /api/agents)"
epic: "EP-008"
acceptance: [{"text":"lib/agents.mjs: register {name, harness, capabilities[], backend, runId, pid}, heartbeat, list, reap; stored in per-machine agents.json","done":true,"at":"2026-09-02T08:14:44.396Z"},{"text":"agents.json registered in the store gitignore contract (NOT_FOR_GIT) and doctor repo-hygiene stays green","done":true,"at":"2026-09-02T08:14:44.496Z"},{"text":"dispatch auto-registers spawned workers; tm agent list|heartbeat|reap, tm_agents MCP, /api/agents route all expose it","done":true,"at":"2026-09-02T08:14:44.597Z"},{"text":"claims interlock for non-registered sessions unchanged — pinned claims tests stay green","done":true,"at":"2026-09-02T08:14:44.705Z"}]
evidence: [".bytedesk/task-management/evidence/TM-066-tm066.log"]
commits: []
blockedBy: []
blocks: ["TM-067","TM-068"]
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T08:14:45.651Z"
touches: ["task-management/lib/agents.mjs","task-management/tests/unit/agents.test.mjs"]
labels: ["ready-for-agent"]
closed: "2026-09-02T08:14:45.646Z"
---

