---
id: "TM-092"
kind: "task"
status: "done"
created: "2026-09-05T04:01:23.096Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Make agents a first-class resource type with a project-level library"
epic: "EP-014"
acceptance: [{"text":"agentDirs() resolves agents with the same four-tier search path as skills, roles and providers","done":true,"at":"2026-09-05T07:38:47.561Z"},{"text":"A spec can reference a stored agent by id with inline fields overriding the stored definition","done":true,"at":"2026-09-05T07:38:47.683Z"},{"text":"The agent schema accepts an mcp field","done":true,"at":"2026-09-05T07:38:47.794Z"},{"text":"A system prompt can be supplied from a file as well as inline","done":true,"at":"2026-09-05T07:38:47.914Z"},{"text":"An agent stored in one repo can be listed and inspected from the CLI","done":true,"at":"2026-09-05T07:38:48.041Z"}]
evidence: [".bytedesk/task-management/evidence/TM-092-topology-spec.test.mjs"]
commits: ["8f135ad","25c5664","d547b0e"]
blockedBy: ["TM-089","TM-100"]
blocks: ["TM-094"]
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T07:38:48.293Z"
touches: ["agent-orchestration/topology/lib/resolve.mjs","agent-orchestration/topology/lib/spec.mjs"]
comments: [{"author":"main","ts":"2026-09-05T04:17:48.059Z","text":"Now depends on TM-100 — a stored agent definition carries its identity (static id, name, title) alongside its configuration (instructions, skills, mcp, candidates)."},{"author":"main","ts":"2026-09-05T05:02:39.282Z","text":"Claude-side rails confirmed present in the CLI: --append-system-prompt-file for the file-backed prompt, --add-dir for granting access outside cwd. The file-backed prompt AC has a concrete mechanism rather than needing one invented."},{"author":"main","ts":"2026-09-05T07:38:47.437Z","text":"All five AC met. agentDirs() mirrors skillDirs/roleDirs including the consumer fallback; a spec entry may reference a stored agent by id, by full name or by the displayed 'Name, Title' form, with any inline field overriding the stored definition and an unknown ref failing with the roster and the search path; mcp is in the schema and documented in specSchemaSummary; instructions_file gives a file-backed system prompt resolved against the agent's own directory, and a missing one is fatal at materialization rather than silently empty. The CLI list/show path is exercised against two real repos by tests/live/two-projects.sh. docs/topology.md now documents the agent library as a first-class resource type alongside templates, skills, roles and providers."}]
closed: "2026-09-05T07:38:48.288Z"
---

An agent today exists only as an inline member of a spec's agents[] array. Templates, skills, roles and providers each have a *Dirs() resolver with a four-tier search path; agents have none, which is the single gap between the current schema and a project-level agent library. The schema already carries most of a role definition: instructions is a system prompt, skills[] resolves against the skill dirs, candidates is a provider failover chain, role selects one of seven packs, and args/env/cwd/auto_approve are launch config. Missing: an mcp field (grep for mcp across spec.mjs, providers.mjs and every providers/*.json returns nothing) and a file-backed prompt so a long system prompt is versionable the way roles/*.md already is. The gateway has per-project MCP injection (materializeProjectMCPConfig, claude and pi only) and no prompt or skills rail - the complement of what ao has.