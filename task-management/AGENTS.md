# Task Management

Durable multi-harness task store at `.bytedesk/task-management/`.

| Harness | How it loads | Native tools mirrored |
|---------|--------------|------------------------|
| Claude Code | `.claude-plugin/plugin.json` + `hooks/hooks.json` + `.mcp.json` | `TaskCreate`, `TaskUpdate` |
| Codex | `.codex-plugin/plugin.json` + hooks + `.codex-mcp.json` | `update_plan` |
| Grok | plugin install + MCP config | `todo_write` |

Every capability is also reachable through `bin/tm` and MCP `tm_*` tools. Prefer those for full
lifecycle (start/done/block/AC); native tools are mirrored into the same board.

## Rules for agents working in a repo with this plugin

1. **The store is the truth.** Session todo state is a mirror. When resuming, read `tm board`
   before trusting anything you remember.
2. **Work belongs to an epic.** `tm epic use <id>` or `tm epic new "<title>"` first; task
   creation is gated on it.
3. **Give every task acceptance criteria** (`tm ac <id> "<criterion>"`) and tick them only when
   verified. Closing is gated on them, deliberately.
4. **Attach proof, not claims** — `tm evidence <id> <path|->` for test output, `tm link <id> <ref>`
   for commits the hook didn't catch.
5. **Never leave a task `in_progress` at the end of a session.** Close it, block it with a
   reason, or park it. The Stop gate will ask once.
6. **Don't hand-edit `index.json` or `events.jsonl`.** Edit task markdown freely, then `tm reindex`.
7. **You are not alone in this store.** Every git worktree of the project shares one board. `tm start`
   refuses a task another live session holds — pick something else with `tm next`, or take it
   deliberately with `--steal`. Claims expire, so a dead session never blocks the board.
8. **Parallel work belongs in a worktree.** `tm parallel` shows which tasks can run at once (disjoint
   `touches`); `tm worktree new <id>` gives you an isolated checkout with `node_modules` already
   shared, so it costs kilobytes and no reinstall.

## Skills & commands

- **epic** — open or switch the active epic; the front door for new work.
- **board** — current state: in progress, blocked, next unblocked, stale.
- **adr** — write (or finish an auto-drafted) architecture decision record.
- **handoff** — self-contained brief for a subagent, worktree, or tomorrow.
- **standup** — what changed since a timestamp, straight from the event log.
- **groom** — backlog pass: zombies, duplicates, false blocks, missing criteria.
- **override** — bypass one gate, with the reason recorded.

## Issue fields

`tm assign|label|priority|estimate|comment|subtask|link|rank|backlog` set the Jira-shaped fields.
All optional. Links write both ends; subtasks refuse cycles; ranks are sparse so a reorder
touches one file. The dashboard writes through the same functions, so anything you do in the
terminal shows up there and vice versa — there is one source of truth, not two.

## Reading the store

`tm show <id>` for one entity, `--json` on any read verb (`board`, `next`, `find`, `stale`, `log`,
`time`, `standup`, `worktree list`, `parallel`) for structured output. `tm log <id>` is one task's
whole history. If MCP is available, prefer the `tm_*` tools — same gates, typed results.

## CLI

`bin/tm help` lists every verb. `bin/tm-dashboard` serves the live board.

`tm` and `tm-dashboard` are symlinked onto PATH by the SessionStart hook on first run
(`~/.local/bin`, or `TM_BIN_DIR`); `TM_NO_AUTOLINK=1` opts out, `./install.sh` does it manually,
`tm where` reports store path and link state. The hooks never depend on the symlink — they call
`bin/tm` by absolute path.

## Escape hatches

`TM_ENFORCE=off` disables all gates · `tm override "<reason>"` bypasses one ·
`tm config <key> <json>` changes the policy permanently.
