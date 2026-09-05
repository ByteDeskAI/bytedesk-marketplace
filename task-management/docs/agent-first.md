# Agent-first surfaces

Humans decide. Agents execute. A task labelled `ready-for-agent` is already specified;
dispatch, the pool, collect, and the event stream are how a worker takes it, finishes
it, and reports back.

The three surfaces call the same `lib/` functions and return the same refusal wording.
If a verb is missing from one column, that is a real gap — shell out to the CLI rather
than inventing a flag.

Skill chain: [[caps]] → [[dispatch]] → [[pool]] → [[collect]] → [[agent]] → [[events]].
README recipes live in [Running the loop](#running-the-loop-per-harness).

## Parity — agent-first verbs

| Job | CLI | MCP (38 tools total) | HTTP |
|---|---|---|---|
| Probe the host | `.bytedesk/task-management/bin/tm caps [--json]` | — (shell out; or `GET /api/caps`) | `GET /api/caps` |
| Hand one task to a worker | `tm dispatch <id> [--backend <name>] [--steal]` | `tm_dispatch` `{id, backend?, steal?}` | `POST /api/task/:id/dispatch` `{backend?, steal?}` |
| Pickup loop | `tm pool once\|start\|stop\|status [--dry-run]` | — (CLI / `tm-pool` monitor) | — |
| Pull a worker's result | `tm collect <id>` | `tm_collect` `{id}` | `POST /api/task/:id/collect` |
| Who is running | `tm agent [list] \| heartbeat <name> \| reap` | `tm_agents` `{action, name?}` | `GET /api/agents` |
| Raw event stream | `tm events [n] [--follow] [--since <iso>] [--json]` | — (CLI; dashboard has the stream) | `GET /api/events`, `GET /events` (SSE) |
| Label the go-ahead | `tm label <id> ready-for-agent` | `tm_label` `{id, add:["ready-for-agent"]}` | `POST /api/task/:id/labels` `{add:["ready-for-agent"]}` |

`--json` on any CLI read verb (`caps`, `board`, `next`, `events`, …) is structured output.
MCP already returns JSON. HTTP is JSON except raw-byte routes (`/api/export`, evidence files).

## Parity — all 38 MCP tools

Every `tm_*` tool is a CLI verb (or a field on one). Dashboard routes that write go through
the same `lib/` function; the full HTTP contract is [`dashboard-api.md`](dashboard-api.md).

| MCP | CLI | HTTP |
|---|---|---|
| `tm_board` | `tm board` | `GET /api/board` |
| `tm_next` | `tm next` | (board payload + `nextTasks`) |
| `tm_show` | `tm show <id>` | `GET /api/task/:id`, `/api/epic/:id`, `/api/adr/:id`, `/api/entity/:id` |
| `tm_find` | `tm find <q>` | `GET /api/find?q=` |
| `tm_why` | `tm why <id>` | `GET /api/task/:id/why` |
| `tm_log` | `tm log [n]` | `GET /api/events` |
| `tm_history` | `tm log <id>` | `GET /api/entity/:id/history` |
| `tm_standup` | `tm standup [iso]` | `GET /api/standup` |
| `tm_stale` | `tm stale` | `GET /api/stale` |
| `tm_epic` | `tm epic …` | `POST /api/epic`, `POST /api/epic/:id/close` |
| `tm_task_create` | `tm task new` | `POST /api/task` |
| `tm_task_update` | `tm start\|done\|park\|block\|unblock\|delete\|restore` | `POST /api/task/:id/transition`, `/delete`, `/restore` |
| `tm_task_edit` | `tm edit`, `tm move` | `PATCH /api/task/:id` |
| `tm_task_field` | `tm assign\|priority\|estimate\|type\|rank\|subtask\|dep\|comment\|touches` | `POST /api/task/:id/{assign,priority,…}` |
| `tm_ac_add` | `tm ac <id> "…"` | `POST /api/task/:id/ac` |
| `tm_ac_accept` | `tm accept <id> <n> [--undo]` | `POST /api/task/:id/accept` |
| `tm_evidence` | `tm evidence <id> <path\|->` | `POST /api/task/:id/evidence` |
| `tm_label` | `tm label <id> …` | `POST /api/task/:id/labels` |
| `tm_claim` | `tm claim <id> [--steal]` | `POST /api/task/:id/claim` |
| `tm_handoff` | `tm handoff <id>` | `GET /api/task/:id/handoff` |
| `tm_worktree` | `tm worktree new\|rm\|list` | `POST /api/task/:id/worktree`, `GET /api/worktrees` |
| `tm_link` | `tm link <id> <type> <id>` | `POST /api/task/:id/link` |
| `tm_graph` | `tm graph` | `GET /api/graph` |
| `tm_parallel` | `tm parallel` | `GET /api/parallel` |
| `tm_doctor` | `tm doctor [--fix]` | `GET /api/doctor`, `POST /api/doctor/fix` |
| `tm_export` | `tm export` | `GET /api/export` |
| `tm_time` | `tm time [id]` | `GET /api/time`, `GET /api/task/:id/time` |
| `tm_sprint` | `tm sprint …` | `POST /api/sprint`, `GET /api/sprint/:id` |
| `tm_adr_new` | `tm adr new` | `POST /api/adr` |
| `tm_cap_propose` | `tm cap new` | `POST /api/capability` |
| `tm_cap_list` | `tm cap list` | (board payload) |
| `tm_cap_accept` | `tm cap accept` | `POST /api/capability/:id/accept` |
| `tm_cap_ship` | `tm cap ship` | `POST /api/capability/:id/ship` |
| `tm_cap_drop` | `tm cap drop` | `POST /api/capability/:id/drop` |
| `tm_goal_import` | `tm goal import` | `POST /api/goal/import` |
| `tm_dispatch` | `tm dispatch` | `POST /api/task/:id/dispatch` |
| `tm_collect` | `tm collect` | `POST /api/task/:id/collect` |
| `tm_agents` | `tm agent` | `GET /api/agents` |

CLI-only on purpose: `tm caps`, `tm pool`, `tm events` (plus `init`, `config`, `override`,
`where`, `ntfy`, `reindex`, `migrate`). Caps and events are on HTTP; pool is the
`tm-pool` monitor (`monitors/monitors.json`) plus the CLI verbs.

## Host detection — `tm caps`

Before dispatch picks a launcher it probes the machine. This is a **host** probe, not a
store read — it answers on a bare checkout with no board. `--json` is the raw report.

Probes, each try/caught (`available: false` + reason, never an exception):

1. **orchestration** — `bin/agent-orchestration-mcp`: `TM_ORCHESTRATION_BIN` → sibling
   plugin in a marketplace checkout → `~/.claude/plugins/**/agent-orchestration*/bin/…`
2. **topology** — `bin/ao-topology` in the same sibling plugin: `TM_TOPOLOGY_BIN` → sibling
   `agent-orchestration/` → Claude cache. Needs tmux, and says so when it is missing.
3. **tmux** — `tmux` on `PATH`
4. **manual** — always available (the floor)
5. **CLIs** — `claude`, `codex`, `grok`, `kimi` on `PATH` (version via `-V`, 2s timeout)
6. **sandbox** — `bwrap`, `systemd-run`, `slirp4netns` (orchestration degrades without them)

`GET /api/caps` returns the same `detectHostCaps()` object.

Debug: `TM_HOSTCAPS_DEBUG=1`.

## Dispatch

One verb: claim, mark `in_progress` (this **is** a start — `gateStart` / WIP applies),
provision the worktree, render `tm handoff`, spawn a backend.

```
.bytedesk/task-management/bin/tm dispatch TM-014
.bytedesk/task-management/bin/tm dispatch TM-014 --backend tmux
.bytedesk/task-management/bin/tm dispatch TM-014 --steal
```

MCP: `tm_dispatch` `{ "id": "TM-014", "backend": "tmux", "steal": false }`.
HTTP: `POST /api/task/TM-014/dispatch` `{ "backend": "tmux" }` → 409 on the same refusals.

**Backends**, richest first, `manual` last — topology → tmux → orchestration → manual
(ADR-0001, `agent-orchestration/docs/adr/0001-authoritative-orchestration-layer.md`).
Config `dispatch.backends` overrides the list;
an empty list is ignored. Pinning `--backend <name>` skips the walk — asking for one
explicitly and silently getting another is how work lands in a harness nobody is watching.

| Name | What it launches | Notes |
|---|---|---|
| `topology` | `ao-topology launch --consumer <tm worktree>` | one agent, tm's worktree reused as the consumer — no second checkout; identity from the repo's agent library when it has one |
| `orchestration` | agent-orchestration MCP `spawn` | demoted: derives its OWN detached worktree, so it costs a second checkout. Pick it explicitly for sandboxed autonomous writes. Idempotency key `<task>-<session>` |
| `tmux` | session `tm-<id>` | durable prompt at `<worktree>/.tm-dispatch-prompt.md` (argv vanishes with the process) |
| `manual` | nothing | prints the commands to run; never unavailable |

Every backend launches argv-only with `shell: false`. The prompt is arbitrary markdown and
is never interpolated into a shell string.

**Refusals** (same wording on CLI / MCP / HTTP):

- task not found; task is `done`/`deleted` — reopen first
- no backend available — lists `tried: [{name, reason}]`
- already dispatched **and** a live claim — `collect` first, or `--steal`
- claim held by another live session — `--steal` is deliberate and logged as `claim_stolen`
- WIP (`gateStart`) — same cap as `tm start`

On any failure **after** a claim this call created: the claim is released and the status
put back. A claim that predated the call is never released here.

A successful dispatch stamps `dispatched: {backend, run, session, at}` on the task,
registers `agent:<id>-<session-prefix>` in `agents.json`, and starts a heartbeat every
`dispatch.heartbeatSeconds` (default 60; `0` disables).

Worker env: `TM_SESSION_ID` and `TM_ACTOR` are the **dispatching** session; `TM_ROOT` is
the repo. Do not override them — they are how the work attributes.

The handoff for a `ready-for-agent` task ends with the completion contract: tick each
criterion (`tm accept`), attach proof (`tm evidence`), then `tm done` or `tm block` with
a reason. Never leave the task `in_progress`.

## Pool

Dispatch on a loop. Scans open, unblocked, unclaimed `ready-for-agent` tasks and
dispatches up to `dispatch.poolWip` (default 3), preferring a `tm parallel` batch
(disjoint `touches`). Each tick **collects finished workers first** so a terminal
result frees its slot. Per-backend ceilings: `dispatch.backendCaps`, e.g. `{"tmux":2}`.

```
.bytedesk/task-management/bin/tm pool once              # one tick
.bytedesk/task-management/bin/tm pool once --dry-run    # show what it would pick
.bytedesk/task-management/bin/tm pool start             # daemon; pid in pool.pid
.bytedesk/task-management/bin/tm pool status
.bytedesk/task-management/bin/tm pool stop
```

**Kill-switches.** `TM_ENFORCE=off` or `dispatch.enabled: false` makes a tick report
`{ disabled: true }` and dispatch nothing. The **monitor** (`tm-pool`,
`tm pool run --auto`) additionally **exits 0 immediately** unless
`dispatch.enabled: true` — an autostarted daemon nobody asked for must not start
work. The explicit verbs above work regardless of that config flag; they still
honour the kill-switches on the tick itself.

The pool never touches unlabelled work. The label is the human's go-ahead.

No MCP / HTTP verb — drive it from the CLI or the plugin monitor.

## Collect

Each backend's collector reads its own completion signal and normalizes it through
one write path (`recordResult`):

| Backend | Terminal signal |
|---|---|
| orchestration | run state in `{succeeded, failed, cancelled, timed_out, rejected, recovery_required}` |
| tmux | session `tm-<id>` gone |
| topology | tmux session named by the run gone |
| manual | nothing to collect — the human closed the task |

```
.bytedesk/task-management/bin/tm collect TM-014
```

MCP: `tm_collect` `{ "id": "TM-014" }`. HTTP: `POST /api/task/TM-014/collect`.

**Invariants:**

1. A collector **never** closes a task. The worker closes through `tm done`. A "done"
   report on a task that is not done **downgrades to failed** and names the status.
2. `blocked`/`failed` on a still-`in_progress` task **parks it** with the worker's
   summary as the reason and **releases the claim**.
3. The summary is a comment plus one `task_result` event `{id, run, outcome}` —
   `tm log <id>` tells the story.
4. Never throws. `{ ok: false, reason }` on failure. `{ ok, pending: true }` while
   the worker is still running.

Refusal: not found; never dispatched (no `dispatched.run`); no collector for that backend.

## Agent registry

Per-machine runtime (`agents.json`, gitignored next to `state.json`). Dispatch registers
every worker it spawns. Liveness is **derived**: a live pid, or a heartbeat fresher than
`agentTtlMinutes` (default 30; `0` disables).

```
.bytedesk/task-management/bin/tm agent              # list
.bytedesk/task-management/bin/tm agent heartbeat <name>
.bytedesk/task-management/bin/tm agent reap         # mark quiet ones dead; park their tasks
```

MCP: `tm_agents` `{ "action": "list"|"heartbeat"|"reap", "name": "…" }`.
HTTP: `GET /api/agents`.

`reap` parks a dead worker's claimed tasks with the reason and releases the claims —
a dead worker never leaves `in_progress` work nobody is doing.

A broken `agents.json` is a missing dashboard panel, never a failed dispatch.

## Events and webhooks

`tm log` is for people. `tm events` is the machine bus.

```
.bytedesk/task-management/bin/tm events                 # human labels (catalog sentences)
.bytedesk/task-management/bin/tm events 40 --json       # JSONL, last 40 rows
.bytedesk/task-management/bin/tm events --since 2026-09-01T00:00:00.000Z --json
.bytedesk/task-management/bin/tm events --follow --json # byte-offset tail; survives rotation; SIGINT → 0
```

`--json` is JSONL (one object per line), not a pretty array. A bad `--since` is refused.
`--follow` polls ~500ms and reopens after `events.jsonl` rotates (`eventMaxBytes`,
default 5 MB).

HTTP: `GET /api/events?since=&limit=&id=`, SSE `GET /events` (`Last-Event-ID`).

**Webhooks.** Every row POSTed to each URL in config `webhooks` (`[{url, kinds?}]`;
`kinds` filters on the event name). Delivery is `bin/tm-webhook`, spawned detached.
Loopback only (`127.0.0.1`, `localhost`, `*.local`) unless `webhooksAllowRemote: true`.

No MCP tool — pull with the CLI or HTTP.

## Config keys

Set with `.bytedesk/task-management/bin/tm config <key> <json>`. Also `GET|POST /api/settings`
for the catalogued keys (`lib/settings.mjs`). Arrays/objects (`dispatch.backends`,
`dispatch.backendCaps`, `webhooks`) stay `tm config`-only.

| Key | Default | Effect |
|---|---|---|
| `dispatch.backends` | `["topology","tmux","orchestration","manual"]` | fallback order `tm dispatch` walks |
| `dispatch.topologyAgent` | first non-lead in the roster | which stored agent a topology dispatch borrows its identity from |
| `dispatch.topologyCandidates` | `"claude"` | provider chain for a topology dispatch when the repo has no agent library |
| `dispatch.heartbeatSeconds` | `60` | claim re-stamp while the worker is alive; `0` disables |
| `dispatch.enabled` | `false` | the `tm-pool` **monitor** requires `true`; explicit `tm pool` verbs work regardless |
| `dispatch.poolWip` | `3` | cap on pool-spawned workers (independent of interactive `wipLimit`) |
| `dispatch.pollSeconds` | `30` | seconds between `tm pool run` ticks |
| `dispatch.backendCaps` | `{}` | per-backend ceilings on top of `poolWip`, e.g. `{"tmux":2}` |
| `agentTtlMinutes` | `30` | silent agent → dead; reaper parks its tasks; `0` disables |
| `webhooks` | `[]` | `[{url, kinds?}]` |
| `webhooksAllowRemote` | `false` | admit non-loopback webhook URLs |

## Running the loop (per harness)

Same recipe everywhere. The store, CLI, and MCP server are harness-agnostic; hooks
and session identity are not. See README "Running under Codex CLI, Grok, and Kimi".

1. Human (or `/task-management:tickets`) files the work with acceptance criteria.
2. Label it: `tm label TM-014 ready-for-agent` / `tm_label` / `POST …/labels`.
3. Probe: `tm caps --json` (or `GET /api/caps`).
4. Either:
   - one shot: `tm dispatch TM-014` / `tm_dispatch` / `POST …/dispatch`
   - loop: `tm config dispatch.enabled true` then `tm pool start` (or let the monitor run)
5. Worker ticks AC, attaches evidence, `tm done` or `tm block`.
6. Parent: `tm collect TM-014` / `tm_collect` / `POST …/collect`. `tm agent reap` for stragglers.
7. Watch: `tm events --follow --json`, or the dashboard SSE.

### Claude Code

MCP is already on (`.mcp.json` → `bin/tm-mcp`). Skills load from `skills/`.
Hooks inject the board at SessionStart / PreCompact and gate Stop on `in_progress`
claims. Prefer `tm_dispatch` / `tm_collect` / `tm_agents`; shell `tm caps` / `tm pool`
/ `tm events`. Session: `CLAUDE_CODE_SESSION_ID`.

### Codex CLI

```
codex mcp add task-management -- <plugin>/bin/tm-mcp
# hooks: project launcher, not plugin-root substitution
grep -v '^//' <plugin>/hooks/codex-hooks.example.json > .codex/hooks.json
```

Session arrives as payload `session_id` (Codex exports no env); the hook adopts it as
`TM_SESSION_ID`. Native `update_plan` is mirrored. Same MCP tools as Claude.

### Grok

```
grok mcp add task-management -- <plugin>/bin/tm-mcp
```

Session: `GROK_SESSION_ID`. Native `todo_write` is mirrored. **No hook surface** — no
SessionStart briefing, no Stop gate, no automatic commit linking. Drive the board with
MCP and the CLI. Claims still hold because they read the session variable.

### Kimi Code

No `mcp add`. Write `.kimi-code/mcp.json` (or `~/.kimi-code/mcp.json`):

```json
{ "mcpServers": { "task-management": { "command": "<plugin>/bin/tm-mcp" } } }
```

Append `hooks/kimi-hooks.example.toml` to `~/.kimi-code/config.toml`. Session arrives
on the hook payload (`session_id` → `TM_SESSION_ID`); Kimi exports no env var.
Native `TodoList` is mirrored.

### Cross-repo / CI

`TM_ROOT` selects the store. Every git worktree of a project shares one board
(`--git-common-dir`). A bare shell has no session — claims and events attribute to
nobody unless dispatch set `TM_SESSION_ID` on the worker.

## Related skills

[[caps]] [[dispatch]] [[pool]] [[collect]] [[agent]] [[events]] [[implement]] [[tickets]] [[handoff]] [[board]]
