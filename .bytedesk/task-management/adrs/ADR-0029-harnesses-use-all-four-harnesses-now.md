---
id: "ADR-0029"
kind: "adr"
status: "proposed"
created: "2026-09-30T22:41:53.635Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Harnesses: use All four harnesses now"
epic: "EP-021"
decisionKey: "bd6e75c31596"
date: "2026-09-30"
updated: "2026-09-30T22:41:53.641Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-30.
The question asked was: Which harnesses must run task-management from the global install? Claude Code can use ${CLAUDE_PLUGIN_ROOT} and its plugin bin/ on PATH. Codex, Kimi and Grok cannot expand that in hook commands, so they need a fixed path.

## Decision

**Which harnesses must run task-management from the global install? Claude Code can use ${CLAUDE_PLUGIN_ROOT} and its plugin bin/ on PATH. Codex, Kimi and Grok cannot expand that in hook commands, so they need a fixed path.** → chose **All four harnesses now**.

Rejected:
- **Claude only for now (Recommended)** — Plan covers Claude Code fully. Codex/Kimi/Grok hook examples keep working through one generated resolver script at ~/.local/bin (a real file that finds the current plugin at run time, not a symlink), scoped as a later phase.

**The bytedesk-remote-gateway Go code (src/task_management_project.go:80) stats the repo-local tm-dashboard launcher to start the Tasks overlay. Include that cross-repo change in this plan?** → chose **Yes, as a separate PR (Recommended)**.

Rejected:
- **No, leave it out** — Keep the plan inside the marketplace. The gateway overlay would break when launchers are removed, so removal would have to wait.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._