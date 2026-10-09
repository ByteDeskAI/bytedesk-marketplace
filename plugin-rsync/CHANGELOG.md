# Changelog

## Unreleased

### Fixed
- **`trust-codex-hooks` trusts only this marketplace's own hooks (TM-485, PR #227 review).** It used
  to trust every untrusted `<plugin>@bytedesk` hook. Now a hook qualifies only when: Codex's
  `[marketplaces.bytedesk]` source is this checkout (or, for a copy running from Codex's own cache,
  a marketplace named bytedesk; or the `ByteDeskAI/bytedesk-marketplace` GitHub repo); the hook's
  `source` is `plugin`; its `sourcePath` is inside that plugin's Codex cache; and its command is an
  interpreter plus absolute paths inside the same plugin root, with no shell syntax. A `modified`
  hook is trusted only when its hooks file and scripts are byte-identical to this marketplace's
  source. `codex` and `grok` are resolved from absolute `PATH` entries and run from the plugin root
  with a reduced environment. The trust lock honours `CODEX_HOME` and creates its parent, so a
  machine without `~/.codex` no longer fails with `ENOENT`. A stale lock is renamed aside before it
  is removed, so two runs cannot both take it.
- **`plugin-rsync-mcp` no longer runs `fix-grok-installs`** (TM-485). It starts only the trust run,
  from the plugin root with a reduced environment. The session hook still repairs Grok installs.
- **`fix-grok-installs` touches only bytedesk plugins, and never grants trust (TM-485).** It used to
  reinstall any local marketplace's plugins with `--trust` on every session start. It now acts only
  on a marketplace whose `marketplace.json` is named `bytedesk`. An entry that was not trusted —
  `trusted: false`, or listed in `~/.grok/config.toml` `[plugins].disabled`, which is how this Grok
  records it — is reported and left alone. A failed `grok plugin uninstall` is reported with its
  exit code and output, and nothing is installed over the old copy.

### Added
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
