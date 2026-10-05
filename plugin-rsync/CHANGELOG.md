# Changelog

## Unreleased

### Added
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
