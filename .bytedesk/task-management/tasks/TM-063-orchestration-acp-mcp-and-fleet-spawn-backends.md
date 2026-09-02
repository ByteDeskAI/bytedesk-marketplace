---
id: "TM-063"
kind: "task"
status: "done"
created: "2026-09-02T06:55:56.047Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Orchestration (ACP/MCP) and fleet spawn backends"
epic: "EP-007"
acceptance: [{"text":"orchestration backend is a stdio JSON-RPC client to agent-orchestration-mcp calling orchestration_spawn/wait/events/cancel with consumerCwd = provisioned worktree","done":true,"at":"2026-09-02T08:14:43.962Z"},{"text":"task text is never shell source; bounded buffers; prompt-injection and path-traversal contract tests pass","done":true,"at":"2026-09-02T08:14:44.076Z"},{"text":"fleet backend shells fleet/bin/spawn-claude-feature with --prompt-file from tm handoff when fleet + tmux present","done":true,"at":"2026-09-02T08:14:44.181Z"},{"text":"with orchestration present dispatch returns a run id recorded on the task; without it, falls through to next backend","done":true,"at":"2026-09-02T08:14:44.288Z"}]
evidence: [".bytedesk/task-management/evidence/TM-063-tm063.log"]
commits: []
blockedBy: ["TM-062"]
blocks: ["TM-064"]
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T08:14:45.540Z"
touches: ["task-management/lib/dispatch/fleet.mjs","task-management/lib/dispatch/orchestration.mjs","task-management/tests/unit/dispatch-backends.test.mjs"]
labels: ["ready-for-agent"]
closed: "2026-09-02T08:14:45.536Z"
---

