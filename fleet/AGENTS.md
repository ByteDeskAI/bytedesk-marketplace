# Fleet

Parallel multi-session Claude orchestration with hierarchical authorization, depth-aware delegation, and tool-level event observability. Spawn agents on tickets, watch a dashboard, get notified when reviews land or merges happen.

This plugin works across Claude Code, Codex, and grok-cli. Claude Code loads it via `.claude-plugin/plugin.json`; Codex via `.codex-plugin/plugin.json`; grok-cli and other AGENTS.md-aware agents read this file.

## Skills & commands

- **chain** (skill) — Dependency-aware multi-stage orchestration of parallel sessions.
- **cleanup** (skill) — Find sessions in the multi-session command center whose PRs have already merged on GitHub, and kill+cleanup each (with confirmation).
- **review** (skill) — Spawn a dedicated reviewer session for a given session's open PR.
- **setup-cli** (skill) — Install thin wrappers in ~/.local/bin/ so the fleet plugin's public CLIs (claude-sessions, claude-sessions-web, spawn-claude-feature) are callable from the user's interactive zsh / bash, not just from
- **spawn** (skill) — Spawn one or many parallel Claude agents on Jira tickets, with full-auto mode and Jira-aware prompt construction.
- **fleet** (skill) — Chat-friendly snapshot of the multi-session Claude command center.
- **tournament** (skill) — Spawn N variant agents on the same Jira ticket, each with a different strategy hint, then auto-spawn a judge that reads all the resulting PRs and merges the best one.
- **wait** (skill) — Block until one or more sessions reach a target state (default done).
