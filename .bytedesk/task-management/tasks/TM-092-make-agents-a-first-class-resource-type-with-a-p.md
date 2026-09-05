---
id: "TM-092"
kind: "task"
status: "blocked"
created: "2026-09-05T04:01:23.096Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Make agents a first-class resource type with a project-level library"
epic: "EP-014"
acceptance: [{"text":"agentDirs() resolves agents with the same four-tier search path as skills, roles and providers","done":false},{"text":"A spec can reference a stored agent by id with inline fields overriding the stored definition","done":false},{"text":"The agent schema accepts an mcp field","done":false},{"text":"A system prompt can be supplied from a file as well as inline","done":false},{"text":"An agent stored in one repo can be listed and inspected from the CLI","done":false}]
evidence: []
commits: []
blockedBy: ["TM-089"]
blocks: ["TM-094"]
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T04:02:32.506Z"
touches: ["agent-orchestration/topology/lib/resolve.mjs","agent-orchestration/topology/lib/spec.mjs"]
---

An agent today exists only as an inline member of a spec's agents[] array. Templates, skills, roles and providers each have a *Dirs() resolver with a four-tier search path; agents have none, which is the single gap between the current schema and a project-level agent library. The schema already carries most of a role definition: instructions is a system prompt, skills[] resolves against the skill dirs, candidates is a provider failover chain, role selects one of seven packs, and args/env/cwd/auto_approve are launch config. Missing: an mcp field (grep for mcp across spec.mjs, providers.mjs and every providers/*.json returns nothing) and a file-backed prompt so a long system prompt is versionable the way roles/*.md already is. The gateway has per-project MCP injection (materializeProjectMCPConfig, claude and pi only) and no prompt or skills rail - the complement of what ao has.