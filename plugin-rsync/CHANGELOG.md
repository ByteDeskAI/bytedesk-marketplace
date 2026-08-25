# Changelog

## Unreleased

### Added
- **plugin-rsync** (BDM-75). User-scope CLI that rsyncs marketplace plugin source into installed Claude, Grok, and Codex caches. No args = every installed bytedesk plugin; one name or a comma-separated list. `--list` / `--dry-run`. `install-cli` writes `~/.local/bin/plugin-rsync`. Never enable in a project.
