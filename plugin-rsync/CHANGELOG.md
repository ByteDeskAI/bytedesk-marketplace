# Changelog

## Unreleased

### Added
- **Every machine pulls its own plugin updates (TM-510).** The session hook now fast-forwards this
  machine's bytedesk-marketplace checkout (the one Claude registered, or the repo the session
  starts in) from `origin/main`, in the background and at most every 10 minutes
  (`hooks/pull-marketplace.sh`). The checkout's post-merge hook then rsyncs the plugins the pull
  touched into the Claude, Codex and Grok caches. Fast-forward only: local commits, another branch,
  a worktree, or uncommitted changes the pull would overwrite are left alone.
- **`--json` activation report** (TM-388, ADR-0041). Per plugin: each refreshed cache (`host`, `path`, `changed`) and each changed path from `rsync -i`, classified `live` (bin/ CLIs), `needs-reload` (hooks, skills, commands, agents, monitors, manifests, MCP config, every MCP server and monitor entry point from `.mcp.json`, `.codex-mcp.json` and `monitors/monitors.json` with `./`, `${CLAUDE_PLUGIN_ROOT}/`, `${CODEX_PLUGIN_ROOT}/` or `${PLUGIN_ROOT}/` prefixes, and lib/src/dist when a server or monitor is declared) or a `skipped` host with no install; top-level `reloads_required` per host. With `--dry-run` it previews via `rsync -n`. Report only; never reloads. Default output unchanged.
- **Codex-only machines trust bytedesk hooks with no TUI approval (TM-480).** Codex starts a
  plugin's MCP server without the per-hook trust its hooks need, so plugin-rsync now ships a
  tool-less MCP server (`bin/plugin-rsync-mcp`, `.codex-mcp.json`) whose start runs
  `trust-codex-hooks` and `fix-grok-installs`, detached. The first Codex session trusts the hooks;
  from the second, the session hook runs. `trust-codex-hooks` now takes a lock, so the app-server
  it spawns cannot start another run.
- **`plugin-rsync fix-grok-installs`, run from the session hook in any repo (TM-396).** A Grok
  install whose Local source is a whole marketplace is re-copied on every Grok start (tens of GB of
  worktrees) and Grok times out loading plugins, so no hook runs. This reinstalls each such plugin
  from its own folder; a lock keeps concurrent session starts from racing. No-op otherwise.
- **Automatic sync on every machine, in Claude, Codex and Grok (TM-391).** A SessionStart hook
  (`hooks/hooks.json`, also declared in `.codex-plugin/plugin.json`) turns on the marketplace's
  `scripts/git-hooks` (`core.hooksPath`) in any bytedesk-marketplace checkout where it is unset, so
  commits, merges and rebases there rsync the touched plugins. The git hook now runs this
  checkout's own `plugin-rsync/bin/plugin-rsync`, so no PATH install is needed.
- **`plugin-rsync trust-codex-hooks`**, also run after every Codex sync and on first setup. Codex
  runs a plugin hook only once its hash is trusted; this asks Codex's app-server for untrusted
  `<plugin>@bytedesk` hooks and writes their hashes through its config API, so new or changed
  hooks run without a TUI approval.
- **plugin-rsync** (BDM-75). User-scope CLI that rsyncs marketplace plugin source into installed Claude, Grok, and Codex caches. No args = every installed bytedesk plugin; one name or a comma-separated list. `--list` / `--dry-run`. `install-cli` writes `~/.local/bin/plugin-rsync`. Never enable in a project. Skill directory is `skills/plugin-rsync` (slash `/plugin-rsync`), with both `user-invokable` (Claude) and `user-invocable` (Grok).
