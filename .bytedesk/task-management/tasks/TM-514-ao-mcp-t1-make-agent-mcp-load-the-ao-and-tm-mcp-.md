---
id: "TM-514"
kind: "task"
status: "open"
created: "2026-10-09T05:19:44.613Z"
board: "bytedeskai/bytedesk-marketplace"
title: "AO MCP T1: make agent.mcp load the ao and tm MCP servers for leads, observers and topology workers (today --strict-mcp-config gives them none)"
epic: "EP-029"
acceptance: [{"text":"The launch argv has exactly one --mcp-config, holding only the named servers","done":false},{"text":"An adapter without mcp_config_args refuses a non-empty mcp rather than dropping it","done":false},{"text":"A relaunched lead has host-launcher.cjs and tm-mcp as child processes (live check)","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: ["TM-517","TM-518","TM-519"]
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T08:38:52.863Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-09T08:38:52.853Z","text":"Worker report (TM-525, 2026-10-09): the AO MCP orchestration_mailbox_send tool refuses this repository as a consumer with AO_PLUGIN_ROOT_IS_NOT_CONSUMER, because the marketplace checkout contains the plugin root. Workers here can only use the CLI. EP-029 MCP-first must allow the marketplace (the plugin's own source repo) as a consumer, or the dogfooding repo can never use the MCP path."}]
---

Design detail: .bytedesk/task-management/evidence/EP-autonomy/audit-mcp.md section 5 (T1). Update the affected role prompts to prefer the MCP tool and keep the CLI as a fallback. Tests must fail on an empty result. buildArgv ignores agent.mcp; roles launch with --strict-mcp-config and no --mcp-config. Live leads 88351/88157/88454/739445 have zero MCP children. Add an adapter key mcp_config_args, resolve names through a host-owned registry (ao -> dist/host-launcher.cjs, tm -> bin/tm-mcp), pin AO_AGENT_ID/AO_CONSUMER in each server's env, refuse inline server objects from repo-tracked agent.json (TM-501), and correct permissions.mjs RESTART_NOTE.