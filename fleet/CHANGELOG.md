# Changelog

All notable changes to the `fleet` plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this plugin adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial extraction from `ByteDeskAI/bytedesk-platform` as a Claude Code marketplace plugin.

### Changed

- Skill `name:` fields and prose migrated to plugin-namespaced form (BDM-2). Frontmatter is now `name: spawn`, `name: review`, etc.; the slash-command surface is `/fleet:spawn`, `/fleet:review`, `/fleet:cleanup`, `/fleet:tournament`, `/fleet:wait`, `/fleet:chain`. The `name: fleet` status skill (root `/fleet`) is unchanged. Tightened the BDP-367 glob-expansion regression test in `hooks/tests/test-pr-merge-guard.sh` so it actually fails when `set -f` is removed from the hook (BDM-9).

## [0.1.0] — 2026-05-09

Initial pre-release. Extracted from `bytedesk-platform` PR #346 (BDP-367 hierarchical authorization) and PR #347 (BDP-372 event observability).

### Added

- `bin/claude-sessions` — dashboard, control plane, notify daemon, ttyd web view.
- `bin/spawn-claude-feature` — worktree + tmux session launcher.
- `hooks/pr-merge-guard.sh` — PreToolUse Bash hook enforcing per-PR authorization (depth 0) with parent-delegated authorization (depth ≥ 1).
- `hooks/event-emitter.sh` — PostToolUse Bash hook writing JSONL events for `gh pr review`, `gh pr merge`, `gh pr create`, `git push`.
- `monitors/monitors.json` — registers the notify daemon as a plugin-managed monitor.
- Skills: `spawn`, `review`, `cleanup`, `tournament`, `wait`, `chain`.
- ADR-0001 — Hierarchical authorization for fleet sessions.
- 59 unit tests across 4 test fixtures + 1 end-to-end smoke test.

### Known limitations

- Plugin can't ship rule files. `docs/RULES.md` is documentation rather than a Claude-loaded context file. Project that want the rule loaded should `cat` it into their own `.claude/rules/`.
- Per-user state at `~/.claude-sessions/` is created by the out-of-band `install.sh`, not the plugin.
