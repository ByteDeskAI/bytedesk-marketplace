# Changelog

## Unreleased

### Added
- **`--json` activation report** (TM-388, ADR-0041). Per plugin: each refreshed cache (`host`, `path`, `changed`) and each changed path from `rsync -i`, classified `live` (bin/ CLIs), `needs-reload` (hooks, skills, commands, agents, monitors, manifests, MCP config, every MCP server and monitor entry point from `.mcp.json`, `.codex-mcp.json` and `monitors/monitors.json` with `./`, `${CLAUDE_PLUGIN_ROOT}/`, `${CODEX_PLUGIN_ROOT}/` or `${PLUGIN_ROOT}/` prefixes, and lib/src/dist when a server or monitor is declared) or a `skipped` host with no install; top-level `reloads_required` per host. With `--dry-run` it previews via `rsync -n`. Report only; never reloads. Default output unchanged.
- **plugin-rsync** (BDM-75). User-scope CLI that rsyncs marketplace plugin source into installed Claude, Grok, and Codex caches. No args = every installed bytedesk plugin; one name or a comma-separated list. `--list` / `--dry-run`. `install-cli` writes `~/.local/bin/plugin-rsync`. Never enable in a project. Skill directory is `skills/plugin-rsync` (slash `/plugin-rsync`), with both `user-invokable` (Claude) and `user-invocable` (Grok).
