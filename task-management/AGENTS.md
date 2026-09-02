# Task Management

Durable multi-harness task store at `.bytedesk/task-management/`.

| Harness | How it loads | Native tools mirrored |
|---------|--------------|------------------------|
| Claude Code | `.claude-plugin/plugin.json` + `hooks/hooks.json` + `.mcp.json` | `TaskCreate`, `TaskUpdate` |
| Codex | `.codex-plugin/plugin.json` + hooks + `.codex-mcp.json` | `update_plan` |
| Grok | plugin install + MCP config | `todo_write` |
| Kimi Code | `[[hooks]]` in `~/.kimi-code/config.toml` (see `hooks/kimi-hooks.example.toml`) + MCP config | `TodoList` |

Every capability is also reachable through the project launcher and MCP `tm_*` tools. Prefer
those for full lifecycle (start/done/block/AC); native tools are mirrored into the same board.

## Rules for agents working in a repo with this plugin

1. **The store is the truth.** Session todo state is a mirror. When resuming, read `.bytedesk/task-management/bin/tm board`
   before trusting anything you remember.
2. **Work belongs to an epic.** `.bytedesk/task-management/bin/tm epic use <id>` or `.bytedesk/task-management/bin/tm epic new "<title>"` first; task
   creation is gated on it.
3. **Give every task acceptance criteria** (`.bytedesk/task-management/bin/tm ac <id> "<criterion>"`) and tick them only when
   verified. Closing is gated on them, deliberately.
4. **Attach proof, not claims** — `.bytedesk/task-management/bin/tm evidence <id> <path|->` for test output, `.bytedesk/task-management/bin/tm link <id> <ref>`
   for commits the hook didn't catch.
5. **Never leave a task `in_progress` at the end of a session.** Close it, block it with a
   reason, or park it. The Stop gate will ask once.
6. **Don't hand-edit `index.json` or `events.jsonl`.** Edit task markdown freely, then `.bytedesk/task-management/bin/tm reindex`.
7. **You are not alone in this store.** Every git worktree of the project shares one board. `.bytedesk/task-management/bin/tm start`
   refuses a task another live session holds — pick something else with `.bytedesk/task-management/bin/tm next`, or take it
   deliberately with `--steal`. Claims expire, so a dead session never blocks the board.
8. **Parallel work belongs in a worktree.** `.bytedesk/task-management/bin/tm parallel` shows which tasks can run at once (disjoint
   `touches`); `.bytedesk/task-management/bin/tm worktree new <id>` gives you an isolated checkout with `node_modules` already
   shared, so it costs kilobytes and no reinstall.

### Dispatched workers

- A task labelled `ready-for-agent` is decided work, safe to hand off. `.bytedesk/task-management/bin/tm dispatch <id>`
  claims it, starts it, provisions its worktree and launches a worker; `.bytedesk/task-management/bin/tm collect <id>`
  records how that worker ended.
- **A dispatched agent owns its claimed task's lifecycle.** It ticks the criteria it verified
  (`.bytedesk/task-management/bin/tm accept`), attaches proof (`.bytedesk/task-management/bin/tm evidence`), then closes
  (`.bytedesk/task-management/bin/tm done`) or blocks with a reason. It never leaves the task `in_progress` — a collector
  or the reaper will park it as a failure, and that lands on the record.
- A worker's identity is its environment: `TM_SESSION_ID` and `TM_ACTOR` name the session that
  dispatched it. Do not override them — they are how the work attributes.
- **The pool only picks up `ready-for-agent`-labelled tasks.** The label is the human's
  go-ahead; the loop never dispatches unlabelled work.
- **Humans keep the decision gates.** Interview, prototype, tickets and enhance-propose
  outcomes are judgement calls; dispatch and the pool execute what those gates already settled.

## Skills & commands

- **epic** — open or switch the active epic; the front door for new work.
- **board** — current state: in progress, blocked, next unblocked, stale.
- **adr** — write (or finish an auto-drafted) architecture decision record.
- **handoff** — self-contained brief for a subagent, worktree, or tomorrow.
- **standup** — what changed since a timestamp, straight from the event log.
- **groom** — backlog pass: zombies, duplicates, false blocks, missing criteria.
- **override** — bypass one gate, with the reason recorded.
- **map** / **interview** / **research** / **prototype** / **spec** / **tickets** / **implement** / **route** — decision-map planning (generic names; not Matt Pocock's). Labels are `decision:*`.
- **caps** / **dispatch** / **pool** / **collect** / **agent** / **events** — agent-first loop. Chain them in that order. Recipe: `docs/agent-first.md`.
- Prefer `.bytedesk/task-management/bin/tm` (or its `.cmd` twin on Windows) or MCP `tm_*`.
  There is no global command.

## Issue fields

`.bytedesk/task-management/bin/tm assign|label|priority|estimate|comment|subtask|link|rank|backlog` set the Jira-shaped fields.
All optional. Links write both ends; subtasks refuse cycles; ranks are sparse so a reorder
touches one file. The dashboard writes through the same functions, so anything you do in the
terminal shows up there and vice versa — there is one source of truth, not two.

## Reading the store

`.bytedesk/task-management/bin/tm show <id>` for one entity, `--json` on any read verb (`board`, `next`, `find`, `stale`, `log`,
`time`, `standup`, `worktree list`, `parallel`, `caps`) for structured output. `.bytedesk/task-management/bin/tm log <id>` is one task's
whole history. If MCP is available, prefer the `tm_*` tools — same gates, typed results.

## CLI

`.bytedesk/task-management/bin/tm help` lists every verb.
`.bytedesk/task-management/bin/tm-dashboard` serves the live board.

Bootstrap once with `node <installed-plugin>/bin/tm init`. It writes the project launchers;
`.bytedesk/task-management/bin/tm where` reports their health and resolved plugin source. Claude
hooks call plugin entrypoints through the host-provided plugin root and never depend on PATH.

## Escape hatches

`TM_ENFORCE=off` disables all gates · `.bytedesk/task-management/bin/tm override "<reason>"` bypasses one ·
`.bytedesk/task-management/bin/tm config <key> <json>` changes the policy permanently.

Completeness gates keep every task fully detailed, all on by default: an explicit create
(CLI/MCP/HTTP — harness mirrors are exempt) needs a body and acceptance criteria
(`requireOnCreate`), starting needs the same (`requireOnStart`), and done adds evidence and
attribution on top of ticked criteria (`requireOnDone`). Mirror-created tasks are never
blocked at done — `doctor` reports them as `incomplete-done` / `incomplete-open` warnings.
