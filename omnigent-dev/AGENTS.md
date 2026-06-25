# Omnigent Dev

Omnigent cross-repo engineering — operator, architect, runtime harness, web deploy, API/SDK, agent bundles.

This plugin works across Claude Code, Codex, and grok-cli. Claude Code loads it via `.claude-plugin/plugin.json`; Codex via `.codex-plugin/plugin.json`; grok-cli and other AGENTS.md-aware agents read this file.

## Skills & commands

- **omnigent-agent-integrator** (skill) — Omnigent agent-bundle and integration skill.
- **omnigent-api-sdk-engineer** (skill) — Omnigent API, SDK, and protocol-contract skill.
- **omnigent-architect** (skill) — Omnigent architecture and plan-review skill.
- **omnigent-engineer** (skill) — Omnigent source-development hub skill.
- **omnigent-operator** (skill) — Omnigent repo operator for worktree lifecycle, workflow.mjs commands, status checks, ship/land/cleanup, local server and host smoke, CLI configuration, and PR-state proof in bytedesk-omnigent.
- **omnigent-runtime-harness-engineer** (skill) — Omnigent runtime, runner, host, tunnel, harness, native bridge, tool dispatch, cancellation, approval/elicitation, and executor engineering skill.
- **omnigent-web-deploy-engineer** (skill) — Omnigent web UI, desktop UI, deployment, auth, server-managed host, sandbox, and packaging skill.
