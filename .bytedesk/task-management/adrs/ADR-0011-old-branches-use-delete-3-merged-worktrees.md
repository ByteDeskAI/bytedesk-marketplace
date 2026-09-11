---
id: "ADR-0011"
kind: "adr"
status: "proposed"
created: "2026-09-11T18:07:38.569Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Old branches: use Delete 3 + merged worktrees"
epic: null
decisionKey: "ef5d56e3a912"
date: "2026-09-11"
updated: "2026-09-11T18:07:38.579Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-11.
The question asked was: Three local branches are superseded: feature/agent-orchestration-observer, tm/TM-134-role-cli and tm/TM-138-producer. Their content reached main through other commits. What should happen to them?

## Decision

**There are also uncommitted graft setup files: hooks and a status line in .claude/settings.json, a section in AGENTS.md, and .cursor/.gemini/.grok/.windsurf config. None of this came up earlier. Should it go into this push?** → chose **remove the .cursor, .gemini, .windsurf cofigsand check to see what should and should not be commited for graft and untrack/gitignore what shouldnt and commit the rest**.

Rejected:
- **Leave out (Recommended)** — Push only the EP-019 work and the board records. The graft files stay uncommitted for a separate decision, because committing the settings.json hooks changes every clone's sessions.
- **Include them** — Commit the graft setup as its own commit in the same push.

**Three local branches are superseded: feature/agent-orchestration-observer, tm/TM-134-role-cli and tm/TM-138-producer. Their content reached main through other commits. What should happen to them?** → chose **Delete 3 + merged worktrees**.

Rejected:
- **Delete the 3 (Recommended)** — Remove those three branches and their worktrees after the push. Leave every other worktree alone.
- **Keep everything** — Delete nothing. Only the four temporary worktrees this plan creates are removed.

**fix/orchestration-metadata (session-UI metadata chips, 2026-09-07) is not on main. Its own README says it is not ready: 3 contract tests fail and the mobile layout clips. Another worktree owns it. Should it be part of this push?** → chose **Leave for its owner (Recommended)**.

Rejected:
- **Finish it in this push** — Adds a third worker to fix its contract tests and responsive layout. This may block on publishing the design-tokens 2.2.1 candidate.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._