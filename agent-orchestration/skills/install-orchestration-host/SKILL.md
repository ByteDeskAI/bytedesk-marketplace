---
name: install-orchestration-host
description: Wire Claude Code, Codex, Grok Build, or Kimi as an agent-orchestration host so that host can delegate to the other catalog CLIs. Use when enabling Grok or Kimi as the orchestrator, installing host MCP/skills, or making Codex/Claude load the same control plane.
user-invokable: true
argument-hint: "[--host grok|kimi|codex|claude|all] [--dry-run]"
---

# Install an orchestration host

Claude Code and Codex already load this plugin from their manifests. Grok Build and Kimi Code need
explicit host wiring so they can call `orchestration_*` and spawn the other CLIs.

Delegates are still trusted catalog IDs only: `claude`, `codex`, `grok-build`, `kimi`. Do not spawn
an arbitrary PATH command. Add a new CLI through `docs/EXTENDING.md`.

1. Resolve the installed plugin root (this skill's `../../` from `skills/install-orchestration-host`).
   Do not assume the marketplace source checkout unless that is the installed copy.
2. Preview first:

   ```sh
   node skills/install-orchestration-host/scripts/install-host.mjs --dry-run --all
   ```

3. Apply the hosts the user named (`--host grok`, `--host kimi`, or `--all`).
4. Confirm:
   - Grok: `grok plugin details agent-orchestration` lists skills and MCP servers.
   - Kimi: `~/.kimi-code/mcp.json` contains `agent-orchestration` pointing at `bin/agent-orchestration-mcp`.
   - Codex: `~/.codex/config.toml` has `[plugins."agent-orchestration@bytedesk"] enabled = true`.
   - Claude: project or user plugin enablement includes `agent-orchestration@bytedesk`.
5. Tell the user to start a **fresh** host session. Existing sessions will not see new MCP servers.

Do not print tokens, rewrite unrelated MCP servers, or edit Orca-managed Kimi hook blocks.
