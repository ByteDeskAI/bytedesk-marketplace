# Changelog

All notable changes to the `fleet` plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this plugin adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.14.2] — 2026-05-10

Patch release: ships a clean SPA bundle (1.14.1's binary embedded a
stale `dist/` from a prior dev-mode watch) and surfaces the running
build version in the UI so binary/SPA drift is observable at a
glance going forward.

### Added

- **`<VersionPill>` in the sidebar brand row (BDM-45):** reads
  `/api/version` live and renders the running server's
  `buildVersion`. Replaces the hardcoded `v1.13` tag. Lets users
  spot at a glance whether the dashboard they're hitting is the
  binary they expect.

### Fixed

- **Stale embedded SPA bundle in 1.14.1 release (BDM-45):** the
  v1.14.1 binary embedded a 392KB `app.js` while the source
  `dist/` had a 593KB build. Cause: `dist/` is a build artifact
  that can drift between dev-mode watches and the release `go
  build`. Cut a clean rebuild for 1.14.2.

### Build

- `fleet/web/build.sh` now `rm -rf server/dist` before `npm run
  build` so each release embed is guaranteed fresh, and prints the
  md5 of the embedded `app.js` / `app.css` so log readers can
  verify what landed in the binary.
- `buildVersion` v1.14.1-bdm44 → v1.14.2-bdm45. `plugin.json` /
  `marketplace.json` / `web/package.json` bumped to 1.14.2 in
  lockstep per `.claude/rules/version-enforcement.md`.

## [1.14.1] — 2026-05-10

Patch release on top of 1.14.0 with chat-mode polish and the new
reuse-or-reload launch path.

### Added

- **Web-server reuse-or-reload (BDM-44):** new `claude-sessions-web`
  invocations now probe the existing server's `/api/version` and
  defer to it when the running build matches our own
  `buildVersion`. When the build differs (after a `/plugin update`
  with a still-running old binary), the new launch falls through
  to the existing preempt path so the latest version takes over —
  effectively reloading the dashboard. Avoids the standby-polling
  fight between concurrent claude sessions in the same project.

### Fixed

- **Chat connection pill stuck on "reconnecting…" (BDM-43):**
  SSE handlers now write `: hello\n\n` and flush immediately
  after the response headers so the browser's `EventSource.onopen`
  fires within milliseconds (before, headers stayed buffered until
  the first real event — up to 15s on a quiet conversation).
- **Chat connection pill stretched as a tall stadium (BDM-43):**
  scoped the `.chat-tile__list > div { height: 100% }` rule to
  only Virtuoso's scroller (`[data-test-id="virtuoso-scroller"]`)
  so the absolutely-positioned pill keeps its natural size; added
  defensive `height: auto` on the pill + unread banner.
- **Connection pill flickering on transient blips (BDM-43):**
  `setConnection('reconnecting')` is now debounced through a 3s
  timer that any subsequent `transcript`/`stats`/`onopen` event
  cancels. Pill only appears when the SSE feed has been silent
  for ≥3s.

## [1.14.0] — 2026-05-10

**Chat-mode tile + tool visualizers + jsonl-driven UX (BDM-32 → BDM-42).**

### Added

- **Chat-mode tile (BDM-32):** global Terminal/Chat toggle in GridPage. Chat renders structured UIMessages projected from Claude's jsonl via `react-virtuoso` (sticky-bottom autoscroll, infinite-scroll-up history). Composer wired to existing `/api/sessions/<T>/send` (and new `/api/main/send` for the main tile). Sub-agent threads render inline under their parent's `Task` tool-call card (in chat) or as tabs across the tile header (in terminal mode).
- **Per-tool visualizers (BDM-34):** `fleet/web/src/components/visualizers/` registry with specialized cards for File tools (Read viewer, Edit unified diff, Write summary, MultiEdit, NotebookEdit/Read), Shell+Search (Bash terminal, BashOutput stream, Grep highlighted matches, Glob path-tree), Web+Tasks (WebFetch, WebSearch, TodoWrite checklist, TaskCreate/Update/List/Get/Stop/Output), and Misc (Agent/Task launch, ScheduleWakeup, Skill, ExitPlanMode, ToolSearch, …) plus an `mcp__*` wildcard fallback.
- **Markdown rendering (BDM-33):** `marked + DOMPurify` pipeline with smart `MarkdownText` component that detects markdown markers and falls back to `<pre>` for raw indented code. Wired into MessageBubble text parts, AgentVisualizer prompt/report, ScheduleWakeup prompt, Skill output.
- **AskUserQuestion structured form (BDM-33):** detects the tool by name, renders questions as radio/checkbox cards. Submit constructs an arrow-key sequence (`Up×N` + `Down×N` + `Space` + `Enter`) and POSTs to a new `/api/sessions/<T>/keys` endpoint that drives Claude's CLI list-picker.
- **Tool-group collapse (BDM-33):** runs of ≥2 consecutive tool-only assistant messages render as a single expandable card (`▸ N tools — Bash×2, Edit, …`) instead of stacking individually.
- **Per-tool key endpoint:** new `/api/sessions/<T>/keys` and `/api/main/keys` accept `{keys: string[]}` against a tmux key allowlist (`Up`, `Down`, `Space`, `Enter`, …) and shell `tmux send-keys`.
- **Universal composer (BDM-33):** main tile now writable in chat mode via `/api/main/send`; sub-agent threads stay read-only by design.
- **Sub-agent visualization (BDM-32):** server tails `subagents/agent-*.jsonl` per session; populates `TicketStats.SubAgents` with per-agent token + tool tally; `TranscriptEvent.agent_id` routes events to nested threads / per-agent tabs.
- **JSONL transcript catalog:** `fleet/docs/research/0002-claude-code-jsonl-format.md` and `.claude/rules/parsing-claude-jsonl.md` codify the event types so future agents don't re-derive the schema.
- **Optimistic send (BDM-39):** chat composer appends the user's message immediately on submit; deduped against the canonical `user_text` SSE event when claude's jsonl flushes. Roll-back on POST failure.
- **SSE connection indicator (BDM-41):** small pill at top-right of the chat list when the SSE feed is `reconnecting` or `closed` (invisible while live). `useFleetChat` exposes a `connection` state.
- **Infinite-scroll history (BDM-35/37):** `/api/sessions/<T>/messages?before=<id>` returns the prior batch. Client uses Virtuoso's `firstItemIndex` recipe (atomic items + index update) so subsequent scroll-ups continue to fire `startReached`.

### Changed

- **Visual hierarchy redesign (BDM-38):** message-role differentiation by alignment + treatment, not duplicate role labels. User = right-aligned light-blue bubble (3px accent right edge), assistant = plain prose with thin left rail, tool calls = visualizer cards, system = centered chip between dashed lines. CLAUDE / YOU role chips removed.
- **AskUserQuestion card recoloring (BDM-38):** peach/amber → light blue to match the chat's accent voice.
- **Chat-scoped type scale (BDM-40):** larger sizes (13/14/15/16/18/21/26 + 12px chips) inside `.chat-tile` only; rest of the dashboard stays on the original compact scale.
- **Sanitizer fix (BDM-32 follow-up):** `findTranscript` now replaces both `/` and `.` so worktrees nested under `.claude/` resolve to the correct project dir.
- **State cascade fix (BDM-32 follow-up):** error fast-path skipped when `lastAssistant` is more recent than `lastToolResult` — end_turn after a tool error wins.

### Fixed

- **Scroll-bounce on send (BDM-41):** guarded `loadMore` with an `atBottom` check so a tiny chat doesn't bounce to the top on every send.
- **Duplicate user messages (BDM-42):** dropped the `last-prompt` projection on both server (`projectMessages`) and client (`applyDelta`); user prompts are captured purely via the `user` entry's text content. Reload re-projects existing conversations cleanly.
- **Sent message not rendering live (BDM-39):** server now emits `user_text` events for `user` jsonl entries with text content (was silently dropping them as bare `user` events).

### Build

- Bumped `buildVersion` to `v1.14.0-bdm42`. Bundle: 399KB → 593KB across the BDM-32–42 stream (+`react-virtuoso`, `marked`, `dompurify`, preact/compat shim).

## [1.13.0] — 2026-05-10

**Phase 12 of BDM-14: web-dashboard completion (BDM-28).** Closes the remaining ~20 features from the original 47-feature plan in a single PR. Branch: `feature/BDM-28-completion`.

### Added

- **Hot-reload dev mode** (12.0): `npm run dev` runs esbuild --watch + air with `-tags dev`; SSE `dist-rebuilt` topic auto-reloads the browser. `DEV_MODE=1` skips the per-project lock + uses port 7690 so the prod server can keep running on the hashed port.
- **A4 interactive PTY** (12.1): WebSocket `/api/sessions/<T>/pty` (xterm.js + tmux send-keys/pipe-pane/resize-pane). New "Terminal" tab on SessionDetailPanel.
- **B3 multi-PTY grid** (12.1): `#/grid` page with Strategy chips (2×2 / 3×3 / 1+N / Spotlight).
- **A22 worktree git status** + **A21 PR integration** (12.2): new `/api/sessions/<T>/git` and `/pr` endpoints; new `Git` and `PR` tabs in SessionDetailPanel.
- **A23 auth-context badges** (12.2): `depth N` / `--full-auto` / `parent X` chips in the Overview tab.
- **A2 parent → child tree** (12.2): TreeView organism toggled from OverviewPage footer.
- **A10 per-session events feed** (12.2): new Events tab in SessionDetailPanel.
- **A9 clean dead metas** UI button (12.3) in OverviewPage footer.
- **A11 pending rules** (12.3): `#/rules` page lists + cancels rules.
- **A12 notify-daemon state pill** (12.3): Sidebar footer shows daemon liveness.
- **A19 wait-for-state** (12.3): `POST /api/wait` long-poll endpoint.
- **A20 sweep merged** (12.3): OverviewPage footer button wraps `claude-sessions cleanup`.
- **B8 session resumption** + **B9 auto-rebase** (12.3): Resume / Rebase buttons in SessionDetailPanel.
- **A15 spawn from Jira ticket** + **B7 backlog** (12.4): SpawnModal `From Jira` and `From Backlog` tabs are real now. `/api/jira/issue` + `/api/jira/backlog` use `[jira]` block from settings.toml; `JIRA_API_TOKEN` env preferred over stored token.
- **A17 tournament spawn** (12.4): SpawnModal `Tournament` tab spawns N variants with deterministic slugs + parent linkage.
- **A18 chain composer** (12.4): full DAG editor — `ChainCanvas` (vanilla pointer events, SVG edges), `NodePalette`, `ChainNodeInspector`. Persisted at `${plugin-data}/projects/<KEY>/chains/<id>.json`. Runner topologically sorts and dispatches Spawn / Wait / Judge / Condition / Notify / Script nodes.
- **C1 full-text log search** (12.5): `/api/search?q=` walks every session log; `#/search` page renders hits with one line of context.
- **C6 bearer auth middleware** (12.6): Decorator chain `RequestID → Log → Auth` wraps every `/api/*` route. Honors `Authorization: Bearer …` or `?token=`.
- **B13 tamper-evident audit** (12.7): sha256 hash chain over `events.jsonl` written to sidecar `events.hashlog`. `/api/audit/verify[?ticket=]` reports first divergence.
- **B14 tournament bracket** (12.8): `#/tournaments` lists parent-grouped variants; `/<parent>` shows per-variant rows with state + cost + runtime.
- **B10/B11/B12 real Haiku** (12.9): `@anthropic-ai/claude-agent-sdk` Node sidecar invoked over stdio JSON; `HaikuJudgeProvider` with 60s LRU cache + heuristic fallback. `[ai]` block in settings.toml.
- **B15 mobile push hook** (12.10): notify daemon grew an `ntfy` sink reading `[mobile]` from settings.toml.
- **B17 tailscale runner** (12.10): `/api/tailscale/{start,stop,status}` shells the CLI.
- ADR-0003 web dashboard architecture; SMOKE-TEST.md web phase.

### Changed

- Build version → `v1.13.0-bdm28`.
- `distFS` is now `fs.FS`; `//go:embed` lives in `server_embed.go` (build tag `!dev`); `server_dev.go` (tag `dev`) reads from disk.
- `apiDeps` grew `chains *ChainsRepo`.
- Sidebar primary nav wires Chains, Tournaments, Search, Rules to real pages.

## [1.12.0] — 2026-05-10

**Phase 11 of BDM-14: themes (BDM-27 / C7).** Final phase. Light / Dark / Repllt-Blue + 8 accent colors + 3 font choices.

### Added

- `[data-theme="dark"]` and `[data-theme="repllt-blue"]` token overrides in `styles.css`. Light is the no-attribute default.
- `[data-font]` override (jetbrains-mono, system).
- `useTheme` hook — applies `data-theme` / `data-font` / `--color-accent` to `<html>`, persisted via `usePersistentState`.
- SettingsPage Theme section: theme chips, 8 accent swatches, font dropdown. Live preview as you click; `Save` persists to the project's `settings.toml` so a second browser sees the same defaults.

### Changed

- Build version → `v1.12.0-bdm27`.



**Phase 10 of BDM-14: settings page (BDM-26).** Per-project settings persisted at `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/web/settings.toml`.

### Added

- `SettingsRepo` (Repository pattern). Loads/saves a `[mobile]` block (B15 ntfy URL/topic/kinds), a `[tailscale]` block (B17 enabled + funnel), and a `[theme]` block (Phase 11 will fill it in).
- `GET /api/settings`, `PUT /api/settings`.
- `SettingsPage` reachable at `#/settings`. Renders mobile push form + tailscale toggle + suggested CLI snippet.
- Sidebar Settings link routes to `#/settings`.

### Changed

- Build version → `v1.11.0-bdm26`.
- `newAPIDeps` signature grew a `webPath` arg for the settings repo.



**Phase 9 of BDM-14: replay + audit (BDM-25).** Two new pages, hash-routed.

### Added

- `useRoute` hook — minimal hash-based router. `#/`, `#/audit`, `#/sessions/<T>/replay`.
- `AuditPage` (B13) — chronological event feed sourced from `/api/events`. Search across ticket / kind / detail; per-kind color tones. Tamper-evident today via `id = ticket@offset`; a real hash chain lands when B13 server-side gets there.
- `ReplayPage` (B16) — log-only time-travel scrub. Scrub bar, play/pause, 0.5×–4× speed chips. Event sidebar acts as anchor list (jump to closest tick).
- `Replay` button on `SessionDetailPanel`.
- Sidebar primary-nav items now navigate via the hash router.

### Changed

- Build version → `v1.10.0-bdm25`.
- `main.tsx`: switched from single-page mount to a tiny hash-route switcher.



**Phase 8 of BDM-14: intelligence layer (BDM-24).** Stubs for B10/B11/B12 with a clear seam (`JudgeProvider`) for swapping in Haiku later.

### Added

- `JudgeProvider` interface (Strategy pattern) — `JudgeState`, `DriftScore`, `EstimateCost`. Default `heuristicJudge` is pure-function over fields the regex state-derivation already reads; a `HaikuProvider` can replace it without touching the wire shape.
- `SessionView` grows `confidence` (0..1), `drift` (0..1, omitted when ≤0.05), and `objective` (first non-empty log line, ≤120 chars).
- `POST /api/estimate-cost` (B12) — debounced from the SpawnModal as the user types.
- `SpawnModal`: live `Estimated cost: $X – $Y` line beneath prompt.
- `SessionDetailPanel` Overview tab: state-confidence bar; drift bar (only when drift > 5%) with a stuck-agent hint over 60%.
- `SessionTable` row: ⚠ glyph next to state badge when drift > 60%.

### Changed

- Build version → `v1.9.0-bdm24`.
- `sessionToView` rebranded as `sessionToViewWithJudge`; the older un-judged view is still available for tests.

## [1.8.0] — 2026-05-10

**Phase 7 of BDM-14: polish (BDM-22).** Filters, search, shortcuts, density toggle, broadcast, live tab title.

### Added

- Session-table state-filter chips (`All / Active / Needs Input / Done`) + client-side text search across ticket/slug/branch/parent.
- `BroadcastModal` (B6) — server `POST /api/broadcast` fans out a message to every session in `starting/working/needs-input/reviewing`, returns per-ticket result; modal renders the result list.
- `ShortcutsOverlay` (C3) bound to `?`; lists `/`, `g o`, `d`, `n`, `b`, `Esc`.
- `useShortcuts` hook (Strategy: keyboard bindings honor text-input focus).
- `usePersistentState` hook — localStorage-backed `useState` for UI prefs (density today; theme/accent in Phase 11).
- Density toggle (C4) — compact rows on `d` or footer button.
- Live tab title (B2) — `Fleet · 8/12 · 2 ⚠ — <project>` updates from session state.
- Footer toggle row (Broadcast / density / shortcuts).

### Changed

- Build version → `v1.8.0-bdm22`.
- `SessionTable` now takes `density` prop and filters in-memory before render.

## [1.7.0] — 2026-05-10

**Phase 6 of BDM-14: spawn surface (BDM-21).** TopBar `+ Spawn` button now opens a real modal. Reviewer spawn from any session detail panel.

### Added

- `POST /api/spawn` — Builder pattern. Validates ticket/slug/prompt, writes prompt to a temp file, shells `spawn-claude-feature` with proper argv. 400 on invalid input, 502 + stderr on CLI failure.
- `POST /api/sessions/<TICKET>/review` — wraps `/fleet:review`. Spawns `<TICKET>-rev` with `--parent <TICKET>` and `--full-auto`.
- `SpawnModal` organism (Manual / From Jira / From Backlog tabs). Manual is fully wired; Jira/Backlog tabs surface placeholder copy until B7.
- `ReviewModal` inside `SessionDetailPanel`. Optional review prompt; defaults to a generic instruction.
- Toast-style success indicator on `OverviewPage` after a spawn lands.

### Changed

- Build version → `v1.7.0-bdm21`.
- `SessionDetailPanel` action bar: `Send Input | Spawn Reviewer | Kill | Close`.

## [1.6.0] — 2026-05-10

**Phase 5 of BDM-14: steer actions (BDM-20).** Send / Kill / Clean now actually mutate state.

### Added

- `actions.go` — Adapter wrapping `claude-sessions send|kill|clean` so the existing safety + lifecycle invariants stay in one place.
- `POST /api/sessions/<TICKET>/send` body `{message}` — non-empty validation; surfaces CLI stderr as 502.
- `POST /api/sessions/<TICKET>/kill` — pipes `y\n` to the CLI's interactive confirm. Returns **409 Conflict** when worktree has uncommitted changes (BDM-13 safety branch).
- `POST /api/clean` — purge dead-session metas.
- Client `sendMessage`, `killSession`, `cleanDeadMetas` API helpers; 409 → `UNCOMMITTED:` error prefix.
- `SendModal` + `KillModal` in `SessionDetailPanel`. Kill modal renders a distinct warning banner on the safety branch.

### Changed

- Build version → `v1.6.0-bdm20`.

## [1.5.0] — 2026-05-10

**Phase 4 of BDM-14: session detail + log streaming (BDM-19).** Click any row on the overview to inline a detail panel.

### Added

- `SessionDetailPanel` organism — Overview / Logs tabs, breadcrumb, action bar.
- `TerminalView` organism — xterm-style log viewer reading `/api/sessions/<T>/stream` (SSE).
- `GET /api/sessions/<T>/log?tail=N` — last N bytes of the session log.
- `GET /api/sessions/<T>/stream` — SSE stream of log appends. `\n` / `\r` are escape-encoded so the SSE framing survives terminal control characters.
- `OverviewPage` split layout (`overview--with-detail`) when a row is selected.

### Changed

- Build version → `v1.5.0-bdm19`.

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
