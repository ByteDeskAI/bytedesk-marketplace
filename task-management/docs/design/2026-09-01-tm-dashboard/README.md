# Design run 2026-09-01 — task-management dashboard

Promoted from `~/Pictures/claude-design/runs/2026-09-01-tm-dashboard/` (bytedesk-designer arc: discovery → direction → surface → review; identity and publish skipped). Authority `ByteDeskAI/design-system @ f652565`, profile `profiles/task-management`. Status: **exploration — not approved, not production source.** The HTML surfaces are the structural target; their layout is reimplemented in components, their token names are copied verbatim, and nothing is pasted from them.

| Surface | Route(s) | Worker | Read |
|---|---|---|---|
| `surfaces/board.html` | `/board` | FE-board | + `screenshots/board-*` |
| `surfaces/backlog.html` | `/backlog` | FE-board | round 2 (title column fixed) |
| `surfaces/epic.html` | `/epics`, `/epics/:id` | FE-board | |
| `surfaces/task.html` | `/tasks/:id` (inspector over the board) | FE-detail | also decisions, capabilities, plans inherit its section grammar |
| `surfaces/graph.html` | `/graph` | FE-ops-screens | why panel = `GET /api/task/:id/why` |
| `surfaces/timeline.html` | `/activity`, `/standup`, `/reports` | FE-ops-screens | |
| `surfaces/sessions.html` | `/sessions` | FE-ops-screens | dialog = the Modal primitive; fix its 390px collapse |
| `surfaces/health.html` | `/doctor` (+ export, ntfy, override tabs) | FE-ops-screens | round 2 (canvas width fixed) |
| `surfaces/settings.html` | `/settings`, `/help` | FE-ops | |

Every worker reads, in order: `brief.md`, `review/findings.json` (the should-fix list — do **not** inherit the display-size headings, taglines, 480px canvas, coloured priority, one-line title clamp), its surface HTML, and its three screenshots (`<screen>-{1440,390}-dark.png (1024 and light variants stay in the run folder)`). Surfaces load `surfaces/tokens/bytedesk.css` (vendored, `.source-sha`); open them from disk.

Direction pieces (`direction/notes.md`, prompts in `direction/prompts/`): hero/empty-state ground (`hero-preview.jpg` here, full PNG in the run folder), loading/offline ground, OG card. Generated raster is exploration only; never read a colour from it.

Screenshots were taken with Playwright 1.58 headless because the agent-browser MCP server was unavailable this session.
