---
name: install-codex-orchestration-agent
description: Install the bundled cross-provider Codex custom-agent template into personal or project scope with preview and overwrite protection. Use when the user asks to add, configure, or install the Codex orchestration agent after installing this plugin.
user-invokable: true
argument-hint: "[personal | project]"
---

# Install the Codex orchestration agent

The plugin manifest cannot register Codex custom agents. The bundled TOML is an optional ergonomic
wrapper around the MCP tools; it remains a Codex agent and does not itself become Claude, Grok, or
Kimi.

1. Locate `templates/codex-agents/cross_provider_orchestrator.toml` relative to the installed plugin
   root. Do not assume the marketplace source checkout is the installed copy.
2. Ask for scope if it is not explicit:
   - `personal`: `~/.codex/agents/cross_provider_orchestrator.toml`
   - `project`: `<consumerCwd>/.codex/agents/cross_provider_orchestrator.toml`
3. Show the source, destination, and a concise summary before writing.
4. If the destination exists, compare it. Stop on differences unless the user explicitly authorizes
   replacement; an identical file is already installed.
5. Create only the destination directory and file. Do not edit `config.toml`, provider credentials,
   or unrelated agent definitions.
6. Validate that the installed TOML contains `name`, `description`, and `developer_instructions`.
7. Tell the user to start a fresh Codex session before testing the agent.

For project scope, `consumerCwd` must be an explicit absolute repository or worktree path.
