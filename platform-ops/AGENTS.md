# Platform Ops

Production release policy (TeamCity read-only) and Gitflow/Fleet operator.

This plugin works across Claude Code, Codex, and grok-cli. Claude Code loads it via `.claude-plugin/plugin.json`; Codex via `.codex-plugin/plugin.json`; grok-cli and other AGENTS.md-aware agents read this file.

## Skills & commands

- **bytedesk-devops-engineer** (skill) — ByteDesk Gitflow/Fleet release operator.
- **bytedesk-production-release-teamcity** (skill) — ByteDesk production release operator for the TeamCity-only release path.
