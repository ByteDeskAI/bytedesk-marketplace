---
id: "TM-102"
kind: "task"
status: "blocked"
created: "2026-09-05T04:17:36.183Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Per-agent memory using each CLI's native mechanism"
epic: "EP-014"
acceptance: [{"text":"For each supported provider, the native memory mechanism and its scoping key are recorded from measurement, not assumption","done":false},{"text":"Two agents in the same repo do not share memory","done":false},{"text":"An agent's memory survives across spawns of that agent","done":false},{"text":"The provider adapter declares where its memory lives so a new CLI can be added without special-casing","done":false},{"text":"Each agent runs with cwd .bytedesk/agent-orchestration/agents/<id>/ and is granted access to the repo root via --add-dir","done":false},{"text":"The system prompt maps the real work tree, and generated instructions use absolute paths","done":false}]
evidence: []
commits: ["25c5664","d547b0e"]
blockedBy: ["TM-100"]
blocks: []
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T05:02:55.397Z"
touches: ["agent-orchestration/providers"]
comments: [{"author":"main","ts":"2026-09-05T05:02:38.934Z","text":"Decision (owner, 2026-09-05): give each agent its own cwd at .bytedesk/agent-orchestration/agents/<id>/ and map the real work tree for it in the system prompt.\n\nMeasured today: Claude Code keys memory by sanitized cwd (~/.claude/projects/<sanitized>/memory/ confirmed for this session), so a per-agent cwd yields a per-agent memory dir — this does solve the shared-memory problem. 18 project dirs already exist for worktree paths, which is the same mechanism working in practice today.\n\nThe mechanism that makes it safe rather than advisory: `--add-dir <repo-root>` grants tool access to the real tree, and `--append-system-prompt-file` carries the mapping. cwd scopes identity and memory; --add-dir grants access; the prompt explains the arrangement. Without --add-dir the mapping would be prose-only and the agent would be denied access to the tree it is told to work in.\n\nResidual hazard to design for: relative paths still resolve against cwd, so an agent that forgets the mapping reads and writes inside its own agent directory instead of the repo. Prefer absolute paths in generated instructions, and consider whether the agent dir should be empty enough that a stray relative write is obvious rather than silently plausible.\n\nAlternative not chosen but worth measuring against: a per-agent git worktree also produces a distinct memory dir AND makes relative paths correct, at the cost of a worktree per agent and the duplication TM-088 is already resolving."}]
---

Each agent carries its own memory using whatever mechanism its CLI already has, rather than a memory layer invented on top. The mechanisms differ per provider and need measuring rather than assuming: Claude Code keys memory by working directory (~/.claude/projects/<sanitized-cwd>/memory/, where the sanitizer replaces both / and . with -) and also reads CLAUDE.md from the repo, and CLAUDE_CONFIG_DIR may offer a second scoping axis; Codex uses AGENTS.md and ~/.codex/; grok, kimi and pi each have their own and pi's session history lives at ~/.pi/agent/sessions/. The consequence to resolve: two agents working in the same repo share a cwd and would therefore share Claude's memory unless they are given separate working directories or separate config dirs. Decide the scoping axis per provider and record what was measured, because guessing here silently merges two agents' memories.