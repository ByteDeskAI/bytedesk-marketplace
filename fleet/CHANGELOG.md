# Changelog

All notable changes to the `fleet` plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this plugin adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] — 2026-05-10

**Phase 3b of BDM-14: SSE multiplex + EventBus (BDM-18).** Replaces 5s polling with sub-second push. Hooks unchanged at the call site.

### Added

- `fleet/web/server/eventbus.go` — `EventBus` (Mediator pattern). Topic-based pub/sub with non-blocking publish + drop-on-slow-consumer.
- `fleet/web/server/watcher.go` — internal poll-tick (1s) that hashes session/stats/projects/events outputs, detects changes, publishes on the bus. Stays in stdlib (no fsnotify dependency for now).
- `GET /api/stream` — SSE handler. `?topics=sessions,stats,…` to subscribe. Sends `event: <topic>\ndata: {}` on changes; 15s keepalive.
- `fleet/web/src/hooks/useSSE.ts` — single shared `EventSource` per app, topic-keyed callbacks, ref-counted teardown.
- `usePolling` extended: optional `sseTopic` arg; on SSE event, immediate refetch (rather than waiting for the poll tick).

### Changed

- `claude-sessions-web` build version → `v1.4.0-bdm18`.
- `useSessionList`, `useStats`, `useProjects`, `useEventStream` now subscribe to their respective SSE topics.

## [1.3.0] — 2026-05-10

**Phase 3a of the BDM-14 web dashboard plan: read surface (BDM-17).** The SPA now renders against real session data from the project's `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/sessions/` tree. Polling-based hooks; SSE multiplex (Phase 3b) is queued.

### Added

- **Server-side Repos** (Repository pattern): `SessionRepo` parses key=value meta files; `ProjectsRepo` enumerates `${CLAUDE_PLUGIN_DATA}/projects/*/web/config.toml` for the multi-project sidebar; `EventsRepo` reads + merges per-session JSONL events.
- **`StatsCalculator`** (Factory pattern) derives `FleetStats` from sessions + events.
- **State heuristic** ported from bash `session_state()` to Go (`sessionStateFromLog`); regex-based until B10 Haiku replaces it.
- **Token / cost extraction** from log tails (`latestTokens`, `roughCostUSD`) — flat $5/Mtoken until proper per-tier pricing lands.
- **New routes**:
  - `GET /api/sessions` → `SessionView[]`
  - `GET /api/sessions/<TICKET>` → single `SessionView`
  - `GET /api/stats` → `FleetStats`
  - `GET /api/projects` → `Project[]`
  - `GET /api/events?since=…&kinds=…&limit=…` → cross-session feed
- **Client hooks** (Custom-hooks + Observer pattern): `usePolling<T>`, `useSessionList`, `useStats`, `useProjects`, `useEventStream`. One hook per server resource; consumers don't see the polling cadence.
- **OverviewPage rewritten as Container/Presenter**: composes hooks + organisms, hands data via props. Sidebar drives PROJECTS list from `useProjects()` with hyperlinks to each project's own dashboard.
- **SessionTable empty state** with a hint to spawn a session via `spawn-claude-feature` or `/fleet:spawn`.
- **8 new Go tests** covering repo behaviour, state heuristic, route shapes, format helpers.

### Changed

- `claude-sessions-web` build version → `v1.3.0-bdm17`.
- `src/api.ts` — placeholder fixtures removed; types kept; only `fetchVersion` (one-shot) remains as a non-hook helper.

## [1.2.0] — 2026-05-10

**Phase 2 of the BDM-14 web dashboard plan: SPA scaffold (BDM-16).** Preact + esbuild + the atomic-design file layout, with the first read-surface organisms wired against placeholder fixtures so the structure is real — not just empty dirs.

### Added

- `fleet/web/package.json`, `tsconfig.json`, `build.mjs`, `.gitignore` — Node toolchain for the SPA build.
- `fleet/web/src/` — atomic-design layout under `components/{atoms,molecules,organisms,templates,pages}/`.
  - **Atoms**: `Badge` (state-color variants tied to session state), `Button` (default + primary), `Icon` (inline SVG, 9 nav icons), `Sparkline` (SVG polyline from numeric series).
  - **Molecules**: `StatCard` (label + value + delta + sparkline), `SearchField` (input with light state).
  - **Organisms**: `Sidebar` (brand + Views nav + sub-views + Projects + user), `TopBar` (title + time-range pills + Spawn button), `StatRibbon` (6 StatCards from `FleetStats`), `SessionTable` (placeholder rows from `api.ts`).
  - **Template**: `AppShell` (sidebar + topbar + content grid).
  - **Page**: `OverviewPage` mirrors the screenshot's panel 1.
- `fleet/web/src/styles.css` — design tokens via CSS custom properties. Light theme by default; dark / Repllt-Blue variants land in Phase 11 (C7).
- `fleet/web/src/api.ts` — typed placeholder fixtures (`FleetStats`, `SessionRow`); Phase 3 swaps these for real `/api/*` + SSE.
- `fleet/web/build.sh` extended: SPA build (`npm install` if needed → typecheck → esbuild) before the Go binary build.

### Changed

- `fleet/web/server/dist/index.html` is now the esbuild template; loads `/app.js` (24KB) + `/app.css` (7.5KB). Replaces the Phase 1 placeholder.
- `claude-sessions-web` build version → `v1.2.0-bdm16`.

## [1.1.0] — 2026-05-09

**Foundation release for the rich web dashboard (BDM-14, Phase 1).** No UI surface yet — this release lays the lifecycle plumbing under the dashboard so subsequent phases can drop in atoms / molecules / organisms / pages without re-deciding the server architecture. See [BDM-15](https://bytedesk.atlassian.net/browse/BDM-15).

### Added

- `fleet/web/server/` — Go HTTP server (`claude-sessions-web`) registered as a second plugin monitor in `monitors/monitors.json`. Lifetime mirrors the BDM-4 notify daemon: per-project PID lock at `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/web/pid`; standby polling pattern (5s) so two Claude Code sessions in the same project coordinate cleanly; `CLAUDE_SESSION_DEPTH >= 1` short-circuits.
- **Per-project port assignment**, persisted to `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/web/config.toml`. First-load pick is deterministic: `7681 + (sha256(PROJECT_KEY) mod 50)` — same repo lands on the same port across machines. Bind failure walks 7681..7730 and rewrites the config; range exhaustion falls back to an ephemeral port + warns.
- HTTP routes (Phase 1 only): `GET /healthz`, `GET /api/version`, `GET /` (placeholder embedded `index.html`). SPA bundle, repos, SSE/WebSocket fanout, and PTY embed land in subsequent phases.
- `fleet/web/build.sh` — runs `go fmt` / `go vet` / `go test ./...` and emits `fleet/bin/claude-sessions-web`. Currently linux-amd64 only; multi-arch distribution is queued for Phase 2.
- 11 Go unit tests under `fleet/web/server/web_test.go` covering port hashing, range walk, lock acquire / blocked / stale-reclaim / empty-reclaim, TOML round-trip, and project-key determinism.

### Changed

- **BREAKING.** `claude-sessions web` is now **discovery-only**. It reads the project's `web/config.toml` and prints the URL the monitor is bound to; it no longer execs `ttyd`. The dashboard is a plugin-managed monitor, started by Claude Code when the plugin is enabled. Users who want the old `ttyd + cmd_tui` behavior can run `ttyd claude-sessions tui` directly.
- `monitors/monitors.json` is now a 2-entry array: the existing `claude-sessions-notify` monitor plus the new `claude-sessions-web`.
- New `_web_dir` helper in `bin/claude-sessions` next to `_notify_dir` / `_rules_dir`.

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
