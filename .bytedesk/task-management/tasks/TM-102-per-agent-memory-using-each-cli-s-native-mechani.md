---
id: "TM-102"
kind: "task"
status: "blocked"
created: "2026-09-05T04:17:36.183Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Per-agent memory using each CLI's native mechanism"
epic: "EP-014"
acceptance: [{"text":"For each supported provider, the native memory mechanism and its scoping key are recorded from measurement, not assumption","done":false},{"text":"Two agents in the same repo do not share memory","done":false},{"text":"An agent's memory survives across spawns of that agent","done":false},{"text":"The provider adapter declares where its memory lives so a new CLI can be added without special-casing","done":false}]
evidence: []
commits: []
blockedBy: ["TM-100"]
blocks: []
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T04:17:47.714Z"
touches: ["agent-orchestration/providers"]
---

Each agent carries its own memory using whatever mechanism its CLI already has, rather than a memory layer invented on top. The mechanisms differ per provider and need measuring rather than assuming: Claude Code keys memory by working directory (~/.claude/projects/<sanitized-cwd>/memory/, where the sanitizer replaces both / and . with -) and also reads CLAUDE.md from the repo, and CLAUDE_CONFIG_DIR may offer a second scoping axis; Codex uses AGENTS.md and ~/.codex/; grok, kimi and pi each have their own and pi's session history lives at ~/.pi/agent/sessions/. The consequence to resolve: two agents working in the same repo share a cwd and would therefore share Claude's memory unless they are given separate working directories or separate config dirs. Decide the scoping axis per provider and record what was measured, because guessing here silently merges two agents' memories.