# Changelog

All notable changes to the `project-management` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
