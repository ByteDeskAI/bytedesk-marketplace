# Changelog

All notable changes to the `project-management` plugin will be documented in this file.

## [0.6.0] — 2026-06-08

### Added

**Sprint model**
- Sprint `duration_days` field (default 7, configurable at creation). Sprints represent one week of focused work toward a stated goal.
- Sprint `end_date` computed from `started_at + duration_days` when a sprint is started.
- Sprint `epic_ids` field — curated list of epics/tasks the sprint is focused on completing.
- `pm_sprint_manage(create)` accepts `duration_days` and `epic_ids`.

**Issue model — new fields**
- `scope`: AI-native complexity signal (`nano` / `small` / `medium` / `large` / `research`).
- `acceptance_criteria`, `criteria_done` — per-issue checklist; Claude marks criteria done as it implements.
- `links` — structured directional issue links (blocks/relates/duplicates/clones), replacing description-string appending.
- `remote_links` — structured external URLs. Auto-transitions to REVIEW on GitHub PR URLs when issue is IN_PROGRESS.
- `commit_links` — git commit references (sha, message, url).
- `session_summaries` — Claude session summaries for prior-attempt context; prepended to future sessions.
- `flagged_reason`, `flagged_options` — human-input flag data.
- Status `NEEDS_INPUT` — Claude's structured "paused, needs human decision" state.

**11 new MCP tools**
- `pm_context_pack` — single-call context bundle for session start.
- `pm_bulk_create` — atomically create N issues in one call.
- `pm_session_attach` — attach a Claude session summary to an issue.
- `pm_workspace_health` — health report: stale tickets, empty descriptions, childless epics, proposed ADRs.
- `pm_issue_clone` — clone an issue with override support.
- `pm_issue_decompose` — returns epic context + decomposition instruction; Claude calls `pm_bulk_create` with children.
- `pm_issue_triage` — heuristic extraction from raw text into a structured ticket proposal.
- `pm_sprint_retrospective` — generate a `learning` doc summarising a completed sprint.
- `pm_commit_link` — attach a git commit SHA/message/URL to an issue.
- `pm_issue_ask` — assemble full knowledge context and answer a specific question.
- `pm_issue_flag` — set issue to `NEEDS_INPUT` with reason and choice options.

**Dashboard server — 7 new endpoints**
- `GET /api/workspace/health`, `POST /api/issues/bulk`, `POST /api/issues/<id>/clone`, `POST /api/issues/<id>/session`, `POST /api/issues/<id>/flag`, `POST /api/issues/<id>/commits`, `POST /api/sprint/plan`.

**Dashboard SPA**
- Board: scope chips on cards, blocked-by ⛓ indicator (red, with tooltip), swimlane mode by epic (toggle).
- Board + Calendar: `NEEDS_INPUT` → red Lozenge appearance.
- TicketDetailDrawer: NEEDS_INPUT amber banner with one-click resolution options.
- TicketDetailDrawer: acceptance criteria checklist with live progress counter.
- TicketDetailDrawer: Retry with prior context button + collapsible session summaries.
- TicketDetailDrawer: Details / Comments / Activity / Commits tab strip; commit links with SHA and external URL.
- CommandPalette (`⌘K` / `Ctrl+K`): fuzzy search over issues, views, and actions.
- PlanView: Generate Sprint button returning backlog proposal grouped by scope and epic.

### Changed
- `pm_issue_link` and `pm_issue_remote_link` now write to structured arrays instead of appending to the description string.
- `pm_issue_transition` and `pm_issue_get_transitions` handle `NEEDS_INPUT` ↔ `IN_PROGRESS`/`TODO` transitions.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] — 2026-06-08

### Added — 10 docs enhancements

1. **Markdown editor with live preview**: Edit tab is now a side-by-side split pane — raw Markdown on the left, rendered preview on the right, updating in real time as you type. Save/Reset buttons below.

2. **Doc templates per type**: Creating a doc with type ADR, Runbook, Learning, Plan, or Brief auto-fills the content textarea with the standard section structure for that type. A "Template applied" notice confirms when a template was injected.

3. **ADR supersession graph** (`AdrGraph.tsx`): "ADR Graph" button in the docs toolbar opens a visual SVG card graph of all ADRs. Cards are arranged in a grid, coloured by status (accepted=green, deprecated=amber, superseded=grey, proposed=blue), with dashed bezier arrows connecting superseded_by relationships.

4. **Full-text search with excerpt highlighting**: Search bar in the docs toolbar calls `GET /api/docs/search?q=` with 300ms debounce. Results show the doc type, ID, title, and a 100-char excerpt with the search term **bolded** in context. Clear button restores the grid view.

5. **Version history tab**: "History" tab in the reader lists all previous snapshots (version number, timestamp, character count). Clicking a version shows its full content in a read-only panel with a "Restore to editor" button. Snapshots are created automatically on every title or content save.

6. **Comment threads on docs**: "Comments" tab in the reader fetches `GET /api/docs/<id>/comments` and renders threaded Atlaskit Comment components with avatars. A textarea + "Post comment" button posts to `POST /api/docs/<id>/comment`. SQLite backend uses a new `doc_comments` table; JSONL backend embeds comments in the doc record.

7. **Doc health report** (`DocHealthModal.tsx`): "⚕ Health" button opens a Framer Motion modal that calls `GET /api/docs/health` and categorises all findings: empty docs, ADRs missing status, stale accepted ADRs (>90 days), superseded-without-reference, and orphaned child docs. Each finding links to the relevant doc. Shows a green "All clear!" state when no issues exist.

8. **Doc export**: Export dropdown in the reader header offers "This page (Markdown)" and "With children (Markdown)". The toolbar offers "Export all docs (Markdown)". Downloads are triggered via a temporary `<a>` element pointed at the backend export endpoints.

9. **Doc↔Issue bidirectional linking**: "Linked Issues" section in the Read tab shows all issue IDs linked to the doc as removable pills. An input + "Link" button posts to `POST /api/docs/<id>/link`; the × on each pill calls `DELETE /api/docs/<id>/link/<issue_id>`. Backend stores `linked_issues` as a JSON array (TEXT column in SQLite, native array in JSONL).

10. **AI-assisted doc generation** (`DocGenerateModal.tsx`): "✦ AI" button in the reader header opens a split modal — optional context textarea on the left, live terminal panel on the right once generation starts. Claude reads the codebase, writes the doc content via `pm_doc_update`, and the modal auto-closes when the session finishes. Polls `GET /api/docs/<id>/generate/status` every 2s.

### Backend

- `GET /api/docs/search?q=` — full-text search with excerpt extraction
- `GET /api/docs/health` — health report: no_content, adr_no_status, adr_stale, superseded_missing_ref, orphaned
- `GET /api/docs/<id>/export?format=markdown[&include_children=true]` — single-doc or subtree Markdown export
- `GET /api/docs/export?format=markdown` — all-docs Markdown export
- `GET /api/docs/<id>/comments` / `POST /api/docs/<id>/comment` — comment threads
- `GET /api/docs/<id>/versions` / `GET /api/docs/<id>/versions/<n>` — version history
- `POST /api/docs/<id>/link` / `DELETE /api/docs/<id>/link/<issue_id>` — issue linking
- `GET /api/issues/<id>/linked_docs` — reverse lookup
- `POST /api/docs/<id>/generate` / `GET /api/docs/<id>/generate/status` — AI generation
- New `doc_comments` SQLite table; `linked_issues` column; `doc_versions.jsonl` sidecar file
- `pm_store.py` bridge methods added for all new capabilities

## [0.5.4] — 2026-06-08

### Fixed
- **Migration wizard centered correctly**: backdrop is now the flex centering container (`display: flex; align-items: center; justify-content: center`). The modal is a child of the backdrop instead of a sibling, so Framer Motion's `y`/`scale` animations no longer conflict with CSS `transform: translate(-50%, -50%)` which was pushing the modal to the bottom-right.

## [0.5.3] — 2026-06-08

### Added
- **Migration wizard in profile menu**: "Migrate data store…" item opens a 4-step Framer Motion modal:
  1. **Detect** — shows current backend (SQLite / JSONL), record counts (issues/docs/sprints), workspace path, and clickable migration path cards
  2. **Confirm** — shows exactly what will happen, Keep Source toggle (leaves original files as backup)
  3. **Migrating** — spinner while backend runs the copy
  4. **Result** — side-by-side before/after verification table (Issues / Docs / Sprints with Match/Mismatch lozenges); source is only deleted if all counts match and Keep Source is off
- **`GET /api/migrate/status`** — returns current backend type, record counts, available migration paths with descriptions
- **`POST /api/migrate`** — runs migration with full pre/post verification: snapshots IDs before migration, verifies every ID is present in destination, only deletes source on clean pass

## [0.5.2] — 2026-06-08

### Added
- **`pm_migrate` MCP tool** — user-facing migration between backends. Two directions:
  - `sqlite_to_jsonl`: reads `pm.db`, writes `config.json` + `issues.jsonl` + `docs.jsonl`. Deletes the source `pm.db` (and WAL files) unless `keep_source: true`.
  - `jsonl_to_sqlite`: reads JSONL files, writes a fresh `pm.db`. Deletes JSONL sources unless `keep_source: true`. Replays issues, comments, docs, and sprints into SQLite in order.
- Both directions are idempotent on error (source is only deleted after a fully successful migration) and verified with an automated smoke test.

## [0.5.1] — 2026-06-08

### Added
- **JSONL backend** (`pm_backend_jsonl.py`) — new `ConcreteImplementor C` that stores all project data as human-readable, git-diffable text files: `config.json` (project config, ID counters, sprints, activity log) and `issues.jsonl` / `docs.jsonl` (one JSON line per record, comments embedded inside issues). Zero extra dependencies.
- **JSONL is now the default** for new workspaces. `PMStore` factory priority: `postgres://` URL → SQLite if `pm.db` exists (backward compat) → JSONL for all new workspaces. Existing SQLite workspaces are served by `SQLiteBackend` transparently — no migration required.
- **Workspace detection** updated in both `pm_store.py` and `pm_dashboard_server.py` to recognise JSONL workspaces (`config.json` present) alongside SQLite workspaces (`pm.db` present).
- **SQLite → JSONL migration** utility (`JSONLBackend.migrate_from_sqlite`) reads an existing `pm.db` and writes the full dataset into JSONL files. Does not delete the source database.
- **Updated `.gitignore` template**: SQLite binary files (`pm.db`, `pm.db-shm`, `pm.db-wal`) and runtime files remain ignored. JSONL data files (`issues.jsonl`, `docs.jsonl`, `config.json`) are intentionally NOT ignored — teams can choose to commit their PM data since it is text.
- **Concurrency**: in-process thread safety via `threading.RLock`; cross-process safety via `fcntl.flock` on per-collection `.lock` files (POSIX only; best-effort on Windows). All writes use `os.replace()` for atomic file replacement.

## [0.5.0] — 2026-06-08

### Added
- **ADR support as first-class document type**: `doc_type` (`wiki | adr | runbook | learning | plan | brief`), `doc_status` (`proposed | accepted | deprecated | superseded`), and `superseded_by` (DOC-ID reference) added to the `docs` SQLite table. Non-destructive `ALTER TABLE` migration runs automatically on first boot for existing databases.
- **ADR lifecycle**: `pm_doc_create` and `pm_doc_update` accept the new fields. `pm_doc_list` accepts `doc_type` to filter; `pm_doc_list(doc_type="adr")` returns only ADRs. Supersession is a first-class operation: create the new ADR, then update the old one with `doc_status="superseded"` and `superseded_by=<new-id>`.
- **ADR context injected into every execution session**: when `POST /api/run` fires (ticket or epic), the backend fetches all ADRs and prepends a compact digest (ID, status, superseded-by, title) to the Claude prompt. Claude is instructed to read relevant ADRs via `pm_doc_get` before writing any code.
- **ADR creation heuristics in every execution prompt**: clear triggers appended to every ticket/epic session — tech stack choices, cross-cutting patterns, API shape, data model decisions, non-obvious trade-offs. ADR format template (Context / Decision / Consequences / Alternatives) included.

## [0.4.11] — 2026-06-08

### Changed
- **Terminal panel fills full remaining width**: drawer container is now full-viewport (`inset: 0`). Details panel stays 480px; terminal panel takes `flex: 1` so it occupies 100% of the remaining screen width when a session is running. Terminal animation simplified to opacity-only (no width expansion needed).

## [0.4.10] — 2026-06-08

### Fixed
- **Drawer anchored to left edge**: ticket detail drawer now slides in from the left (`left: 0`) instead of the right. Terminal panel expands to the right of the details panel. Close button repositioned to top-left. Box shadow flipped to right-side cast.

## [0.4.9] — 2026-06-08

### Added
- **Split-panel drawer with Framer Motion**: ticket detail drawer replaced with a custom Framer Motion overlay. When a session is running, a terminal panel slides in from the right alongside the details panel (rather than below it) — the drawer expands with a spring animation to accommodate both. Closing the terminal collapses the panel with the same animation.
- **Session reconnect after restart**: `GET /api/run/<id>` now re-registers any alive tmux session back into the in-memory `_sessions` registry if it was lost during a server restart, so the session monitor resumes tracking it immediately.

## [0.4.8] — 2026-06-08

### Added
- **Epic execution**: clicking "Run Epic" on an epic ticket spawns a single Claude session with the full epic context — goal, description, and all child tickets listed in order with their current status. Claude implements children sequentially, transitioning each to IN_PROGRESS then DONE via `pm_issue_transition`, and marks the epic DONE when all children are complete. Re-running a partially-complete epic skips already-DONE/REVIEW children.
- **Child ticket progress table**: the ticket detail drawer for epics now shows all child tickets with their live status (Lozenge), dimmed once DONE/REVIEW, and a "N pending" badge. Statuses update in real time as Claude works through them via SSE.
- **Run button context**: button label reflects epic vs task ("▶ Run Epic (N pending)" / "▶ Run Ticket") and shows the pending child count.

## [0.4.7] — 2026-06-08

### Changed
- **Tabbed planning interface**: PlanView now renders active sessions as tabs rather than a stacked list. Each tab shows the session timestamp and a × kill button that terminates the tmux session immediately. Clicking a tab switches the terminal panel below. Starting a new plan adds a tab and activates it. Killing the active tab auto-selects the most recent remaining session.

## [0.4.6] — 2026-06-08

### Fixed
- **Dead session auto-cleanup**: `GET /api/plan/sessions` now checks each PLAN-* tmux session's foreground process. Sessions where Claude has exited (pane reverted to a shell) are killed automatically and excluded from the response. The session monitor also kills the tmux session when a PLAN-* reaches a terminal state (done/error), preventing accumulation.
- **Kill endpoint + close button**: new `POST /api/plan/kill/<key>` endpoint terminates a planning session on demand. The existing TerminalPanel close button now calls this endpoint, so closing a panel in the UI also kills the underlying tmux session.

## [0.4.5] — 2026-06-08

### Fixed
- **Plan view state restored on navigation**: `PlanView` now fetches `GET /api/plan/sessions` on mount and re-populates any active PLAN-* sessions. Previously, navigating away and back reset React state to `[]`, showing "Start a new plan" even when a session was running.
- **Session recovery across server restarts**: new `GET /api/plan/sessions` endpoint also queries tmux directly for any PLAN-* sessions not yet in the in-memory registry, so planning sessions survive a dashboard server restart.
- **Removed stale story-points column** from `EpicTreeView` (both the `@atlaskit/table-tree` variant and the CSS-grid fallback). References to the removed `story_points` field were causing TypeScript build failures.

## [0.4.4] — 2026-06-08

### Fixed
- **Reliable last-wins port takeover**: `_pick_port` now polls until the port is actually free (up to 3s) after sending SIGTERM to the previous occupant, escalating to SIGKILL after 1s. Previously it slept a fixed 0.4s, which was not enough when the old server was slow to drain connections — causing `OSError: Address already in use` when a new session started while a stale dashboard process from a prior session was still holding the socket. Claude Code does not kill monitor processes on session exit, so this race was reproducible on every new session start when the previous monitor had not been explicitly killed.

## [0.4.3] — 2026-06-08

### Fixed
- **Root-cause fix for first-boot failure**: `_find_pm_root()` was falling back to returning the project directory itself (instead of `project_dir/.pm`) when `.pm/` didn't exist yet. This caused `pm.db`, `events.jsonl`, and `dashboard.pid` to be written to the project root on first boot, then the dashboard failing on the next start when it couldn't find a valid workspace.
- `_find_pm_root()` now always returns `base/.pm` when a workspace path is given, creating the directory if needed.
- `_cleanup_misplaced_files()`: on startup, removes any stale db/event files that old versions wrote to the project root alongside a now-correct `.pm/` directory.
- Both fixes together give a clean first-boot experience: monitor fires → workspace auto-initialized in `.pm/` → dashboard accessible immediately.

## [0.4.2] — 2026-06-08

### Added
- **Auto-init on first boot**: `pm_dashboard_server` now detects an uninitialized workspace and calls `pm_init` automatically before starting the HTTP server. Project name and key prefix are derived from the directory name (e.g. `project-management-plugin-test` → `Project Management Plugin Test`, prefix `PMPT`). Also writes `.pm/.gitignore` on first boot. Users get a working dashboard immediately without needing to run `/pm:init` manually.

### Fixed
- Monitor no longer fails with exit 1 on a fresh project directory — workspace is created in-process before the HTTP server binds.

## [0.4.1] — 2026-06-05

### Fixed
- `atexit` cleanup: pid file and port file are now always removed on process exit regardless of how the process terminates (SIGTERM, crash, clean exit). Previously a SIGTERM arriving before `serve_forever()` started could leave `.pm/dashboard.pid` behind.
- `_pick_port()`: removed dead code (`return base` after `return port`).
- `monitors.json` description updated to reflect fixed port 7900 (was "796x" deterministic hash).
- `App.tsx`: sprint subtitle no longer shows "undefined/undefined story points" — uses `done_tickets`/`total_tickets` which are the actual fields after story points removal.
- Dashboard skill sync: `_write_session_skills()` copies current SKILL.md files from plugin repo into `.claude/skills/` before spawning plan/run sessions, bypassing stale marketplace skill cache.
- `pm_mcp_server.py` version bumped to 0.4.1.

## [0.4.0] — 2026-06-05

### Added
- **Inline terminal sessions**: "Run Ticket" button in the ticket drawer and board card menu spawns a fleet Claude Code session for any ticket. An xterm.js PTY terminal embeds directly in the drawer so you can interact with Claude without leaving the dashboard. Session persists when you navigate away — reattach anytime.
- **PM Planning tab**: New "Plan" sidebar tab launches an interactive planning session. Claude conducts a structured PM interview (using `AskUserQuestion`) and creates the right ticket structure — bug, task, or epic with child tasks — directly on the board via MCP tools.
- **WebSocket PTY bridge**: Pure-stdlib WebSocket upgrade handler + `os.openpty()` PTY bridge added to the Python dashboard server (zero new external dependencies). Route: `ws://localhost:<port>/ws/pty/<session-key>` attaches to `tmux attach-session -t <session>`.
- **Session status API**: `GET /api/run/<ticket>` returns session state; `GET /api/run/<ticket>/log` SSE-streams the fleet log file for fallback display.
- **Automatic ticket status management**: Starting a session auto-advances the ticket (and its parent epic if applicable) to `IN_PROGRESS`. When the session finishes, the ticket advances to `REVIEW`. When all children of an epic are `REVIEW`/`DONE`, the epic closes to `DONE`.
- **Missing REST endpoints**: Added `do_POST` (`/api/issues`, `/api/run`, `/api/plan/start`) and `do_PUT` (`/api/issues/{id}`, `/api/docs/{id}`) to the dashboard server — these were called by the frontend drag-and-drop but previously returned 501.
- **pm-planner skill** (`skills/pm-planner/SKILL.md`): Claude Code skill that acts as a concise PM persona. Uses `AskUserQuestion` to conduct a 5-question interview (feature, problem, scope, breakdown, sizing) and creates tickets via pm MCP tools. Invokable as `/pm:plan`.

### Build
- Added `xterm` (`^5.3.0`) and `xterm-addon-fit` (`^0.8.0`) to dashboard frontend dependencies.
- `ViewId` type extended with `'plan'`.

## [0.3.0] — 2026-06-05

### Added
- **React SPA dashboard** (`dashboard/`) built with Vite + TypeScript, served from `dashboard/dist/` committed to the repo. No npm or Node required at runtime — Python server reads compiled files from disk.
- **Real @atlaskit components**: `@atlaskit/Lozenge` (issue type/status badges), `@atlaskit/Badge` (column counts), `@atlaskit/Avatar` (assignee initials), `@atlaskit/ProgressBar` (sprint SP progress), `@atlaskit/DynamicTable` (sortable backlog list).
- **Authentic Atlassian dark theme**: `setGlobalTheme({ colorMode: 'dark' })` from `@atlaskit/tokens` injects all `--ds-*` CSS custom properties at runtime.
- **Pages view**: doc card grid with type badges (Wiki/ADR/Plan/Learning/Brief/Runbook), hierarchy breadcrumbs, and a slide-in reader panel rendering markdown with Atlassian typography.
- **Backlog view**: `DynamicTable` with sortable columns, Lozenge status/type cells, Avatar assignee cells, pagination.
- **Activity view**: colour-coded action feed with avatar-style icons.
- Python dashboard server updated to serve `dashboard/dist/` static files (replaces embedded HTML string). Long-cache headers for hashed assets (`/assets/*`).
- `dashboard/vite.config.ts` proxy: `npm run dev` proxies `/api` and `/events` to the running Python server for hot-reload frontend development.

## [0.2.0] — 2026-06-04

### Added
- Initial release of the `project-management` plugin (BDM-2).
- Zero-dependency stdio JSON-RPC MCP server wrapper (`pm-mcp` / `pm_mcp_server.py`).
- **SQLite datastore** (default, zero deps) via `lib/pm_backend_sqlite.py`; WAL journal mode for concurrent read/write between the MCP server and the dashboard process.
- **Postgres datastore** (optional, requires `psycopg2`) via `lib/pm_backend_postgres.py`; activate with `PM_DATABASE_URL=postgres://...`.
- **Bridge pattern** (GoF) for pluggable storage: `PMBackend` Protocol defines the implementor contract; `PMStore` is the stable abstraction all callers use; swapping backends requires only an env-var change.
- **Real-time dashboard** (`lib/pm_dashboard_server.py`): Python stdlib `ThreadingHTTPServer`, SSE endpoint tailing `.pm/events.jsonl`, embedded dark kanban HTML — no CDN, no build step, zero new dependencies.
- **PID lock** at `.pm/dashboard.pid` (first-wins): only one dashboard server runs per `.pm/` directory regardless of how many terminals are open.
- **Deterministic port assignment** (`7960 + hash(root) % 40`) persisted in `.pm/dashboard.port`; second server instance prints the URL and exits cleanly.
- **Plugin monitor** (`monitors/monitors.json`): `pm-dashboard` auto-starts as a `"when": "always"` lifecycle monitor so the dashboard is available immediately when the plugin is active.
- MCP `pm_status` tool now includes `dashboard_url` in its response when the dashboard is running.
- `pm-board` skill surfaces the live dashboard URL after calling `pm_status`.
- Support for Jira-like task tracking: create, update, get, list tickets, assignee tracking, story points, and comments.
- Support for Sprint lifecycle: create, start, and complete sprints; unfinished tickets automatically roll back to backlog on sprint completion.
- Support for Confluence-like documentation wiki: create, update, read, and search hierarchical markdown documentation pages.
- Four plugin skills: `pm-init`, `pm-board`, `pm-ticket`, and `pm-doc`.
- Backend contract test suite (`test_pm_backend_contract.py`): proves both backends satisfy the same behavioral specification.
- Dashboard smoke tests (`test_pm_dashboard.py`): health endpoint, HTML render, SSE header, PID lock.
