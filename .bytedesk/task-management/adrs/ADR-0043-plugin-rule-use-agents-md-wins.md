---
id: "ADR-0043"
kind: "adr"
status: "proposed"
created: "2026-10-05T12:30:34.495Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Plugin rule: use AGENTS.md wins"
epic: "EP-028"
decisionKey: "e6dc696b3e49"
date: "2026-10-05"
updated: "2026-10-05T12:30:34.503Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-05.
The question asked was: Two rules conflict. The shared rules file (~/.agents/AGENTS.md) tells each repo to enable its plugins in its own .claude/settings.json. The agent-orchestration guard forbids project-scope enablement of agent-orchestration and task-management, and blocks every commit in agent-fabric until that file changes. Which rule wins?

## Decision

**Two rules conflict. The shared rules file (~/.agents/AGENTS.md) tells each repo to enable its plugins in its own .claude/settings.json. The agent-orchestration guard forbids project-scope enablement of agent-orchestration and task-management, and blocks every commit in agent-fabric until that file changes. Which rule wins?** → chose **AGENTS.md wins**.

Rejected:
- **Guard wins (Recommended)** — Matches your 2026-09-30 direction (global installs, no project-scope). You add one line to AGENTS.md naming agent-orchestration and task-management as user-scope-only exceptions; I do not edit that file myself.

**TM-392 asks agent-orchestration to delete guarded plugin entries from other repos' .claude/settings.json automatically at session start and commit that change. Do you want automatic edits, or should it stop at a precise one-line fix that the repo's lead applies?** → chose **Lead applies fix (Recommended)**.

Rejected:
- **Fully automatic** — SessionStart or the supervisor edits and commits other repos' settings.json itself, failing closed when the plugin is not enabled at user scope. The auto-mode classifier may refuse these edits at runtime.

**The standalone GitHub repo ByteDeskAI/agent-orchestration (v0.2.x, last pushed 2026-09-16) looks superseded by bytedesk-marketplace/agent-orchestration, which ao-topology runs from. What should happen to it?** → chose **Archive on GitHub (Recommended)**.

Rejected:
- **Unregister only** — Leave GitHub as is; just stop the AO services treating its local checkout as a repo needing a lead.
- **Keep it** — It is still in use; leave everything as is.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._