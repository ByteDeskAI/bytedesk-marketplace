# Changelog

All notable changes to the `fleet` plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this plugin adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.2] — 2026-05-09

Docs-only release. Companion repo `bytedesk-platform` PR #349 (BDP-377) stripped fleet implementation details out of its `bytedesk-feature-start` skill and delegated to `/fleet:*`. That audit surfaced four facts about fleet behavior that lived only in bytedesk-platform's skill — they belong here.

### Added

- `fleet/skills/spawn/SKILL.md` — new "What spawning gives you" section covering worktree isolation, `--full-auto` semantics (adds `--dangerously-skip-permissions`; safety must be encoded in the prompt), and the `--prompt-file` rationale (>~4KB inline prompts SIGPIPE; metacharacter escaping is fragile).
- `fleet/skills/cleanup/SKILL.md` — new "Safety" subsection explaining the uncommitted-state refusal in `claude-sessions kill` and how to investigate (the friction is intentional).
- `fleet/README.md` — brief "Worktree isolation" note pointing wrapper-skill authors at `/fleet:spawn` for the full set of consumer-relevant facts.

No code, hook, monitor, or test changes. All 5 fixtures still green.

## [1.0.1] — 2026-05-09

Hot-fix for the manifest shapes shipped in v1.0.0. The actual Claude Code loader expects different top-level structures than the BDM-6 research had documented; the install on a real session surfaced the discrepancy with two `Failed to load ...` errors. No behavioral change to the plugin once it loads — the bug was purely manifest-shape-validation.

### Fixed

- `hooks/hooks.json` root must be `{ "hooks": { "PreToolUse": [...], "PostToolUse": [...] } }`, not `{ "PreToolUse": [...], "PostToolUse": [...] }`. Wrapped accordingly.
- `monitors/monitors.json` root must be a bare array `[ {...} ]`, not `{ "monitors": [...] }`. Unwrapped accordingly.
- `fleet/docs/research/0001-plugin-manifest-lifecycle.md` updated with the empirical correction so the next reader doesn't repeat the mistake.

## [1.0.0] — 2026-05-09

First public release. The v0.1.0 → v1.0.0 sweep moves the plugin from a vendored-via-`install.sh` model to a fully Claude-Code-managed plugin: state, daemon, scripts, and skills all live inside the plugin's runtime contract. Read [`docs/MIGRATION.md`](./docs/MIGRATION.md) before upgrading from v0.1.

### Added

- ADR-0002 documenting the per-project `${CLAUDE_PLUGIN_DATA}` state-directory layout (BDM-5).
- Research note `docs/research/0001-plugin-manifest-lifecycle.md` capturing the manifest/lifecycle findings that informed the v1.0 design (BDM-6).
- `tests/test-notify-lock.sh` — 10 assertions covering the notify-daemon PID lock + depth gate (BDM-4).
- `docs/MIGRATION.md` — step-by-step v0.1 → v1.0 migration for users on the install.sh path (BDM-10).
- `docs/SMOKE-TEST.md` — repeatable install-verification checklist for fresh `/plugin install fleet@bytedesk` runs (BDM-7).
- BDM-11 policy revision: bare word `merge` (no PR# required) now authorizes a depth-0 `gh pr merge`, with negation guard (`don't merge` / `do not merge` / `never merge` / `merge conflict`) suppressing the bare path. The strict path still applies whenever the user names a specific PR#.

### Changed

- **BREAKING.** Per-user state moved from `~/.claude-sessions/` (flat) to `${CLAUDE_PLUGIN_DATA}/projects/<PROJECT_KEY>/sessions/<TICKET>/` (per-project, per-ticket). Plugin owns its own data namespace; uninstall is clean. See ADR-0002 (BDM-3, BDM-5).
- **BREAKING.** `bin/claude-sessions` and `bin/spawn-claude-feature` are now PATH-injected from `${CLAUDE_PLUGIN_ROOT}/bin/` by Claude Code. No more `~/.local/bin/` symlinks (BDM-3).
- **BREAKING.** Notify daemon is now a plugin-managed monitor (`monitors/monitors.json`, `when: "always"`) with a per-project PID lock + stand-by polling pattern. Multiple sessions in the same project coordinate cleanly; one is active and the other(s) stand by, taking over when the holder's session exits (BDM-4).
- `monitors/monitors.json` shape corrected to the documented `{name, command, description, when}` schema. The v0.1 `lifecycle: "plugin-active"` and `restart: "always"` fields don't exist in the documented schema and were silently ignored (BDM-6).
- Removed bogus `$schema` URLs from `hooks/hooks.json` and `monitors/monitors.json` — neither schema is published by SchemaStore (BDM-6).
- Skill `name:` fields and prose migrated to plugin-namespaced form: `name: spawn` etc., slash-command form `/fleet:spawn`. The status skill (`name: fleet`, root `/fleet`) is unchanged (BDM-2).
- Tightened the BDP-367 glob-expansion regression test in `hooks/tests/test-pr-merge-guard.sh` so it actually fails when `set -f` is removed from the hook (BDM-9).

### Removed

- **BREAKING.** `fleet/install.sh` deleted. Plugin install is the only deployment path (BDM-10).
- **BREAKING.** `fleet/systemd/` deleted (`claude-sessions-notify.service`, `claude-sessions-web.service`). Daemon lifetime is now Claude Code session-bound; the per-project lock + stand-by gives equivalent continuous coverage (BDM-10).
- `claude-sessions service` subcommand removed (BDM-10).

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
