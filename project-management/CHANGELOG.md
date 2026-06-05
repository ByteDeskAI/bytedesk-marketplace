# Changelog

All notable changes to the `project-management` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
