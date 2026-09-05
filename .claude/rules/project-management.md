# Project management rules

## task-management is the source of truth for work tracking

All work for this repo lives in the local store at `.bytedesk/task-management/`, driven by
`.bytedesk/task-management/bin/tm` and the `task-management` MCP tools
(`mcp__plugin_task-management_task-management__tm_*`). **Never** track work in local todo files,
in-memory lists, or an external tracker.

The store is git-tracked and shared with the repo, so a clone gets the board. Machine-local parts
(`index.json`, `state.json`, `dashboard.*`, `agents.json`) carry their own `.gitignore`.

> This repo previously used Jira project `BDM` and Confluence space `BDM1`. **That dependency is
> removed.** Historical `BDM-N` keys may still appear in old commit messages and CHANGELOG entries;
> leave them as the historical record, and do not create new ones. The sibling repo
> `bytedesk-platform` may still use its own external tracker — never import that convention here.

## knowledge-management is the source of truth for durable knowledge

Design notes, architecture narratives, runbooks and operational context live in the OKF store at
`.bytedesk/knowledge/`, via `km` and the `knowledge-management` MCP tools. Run `km find <words>`
before inventing knowledge.

Use the knowledge store for what outlives a task: decisions and their rationale, architecture,
references. Use `tm` for what is in flight. Use repo-local `docs/` and `docs/adr/` for anything that
ships inside a plugin.

## Identifiers

| Prefix | Entity | Created by |
|---|---|---|
| `EP-nnn` | Epic — a multi-task initiative | `tm epic new "<title>"` |
| `TM-nnn` | Task | `tm task new "<title>"` |
| `ADR-nnn` | Architecture decision | `tm adr new "<title>"` |
| `CAP-nnn` | Enhancement backlog entry | `tm cap new "<title>"` |

Reference these keys in branch names where practical, in commit messages, and in PR titles and
descriptions, so delivery reconciles against the board from git history alone.

## Issue types and structure

`tm type <id> [bug|story|task|spike|chore]` sets the type; **task** is the default and the right
choice for most work. Subtask-ness is expressed by parentage (`tm subtask <id> <parent>`), not by a
type. An epic groups tasks; `tm move <id> <EP-nnn|none>` reparents.

Cross-cutting labels only — `tm label --catalog` lists what exists, and `tm label <id> <name>` sets
one. Keep the set small and meaningful (`plugin:<name>`, `tech-debt`, `architecture`, `blocked`).
Priority is a field, not a label: `tm priority <id> <level>`.

## Flow

1. **Read the board before acting** — `tm board`, `tm next`, or `tm find <words> field:value`.
   Resume existing work rather than creating a duplicate.
2. **Open the item and its context** — `tm show <id>` for scope, acceptance criteria, dependencies
   and history. `tm why <id>` tells you what is actually blocking it, to the root.
3. **Create only when nothing matches.** `tm task new` with `--ac` criteria, attached to an epic
   when it belongs to one. The store's gates require a body and acceptance criteria at create and
   at start, and evidence plus an actor at done — satisfy them rather than working around them.
4. **Start before coding** — `tm start <id>` claims the task and moves it to in progress. The claim
   is what stops two agents taking the same work; respect the WIP limit.
5. **Keep the board honest while the work moves.** Scope changes, blockers and follow-ups go in as
   they happen: `tm block <id> "<why>"`, `tm dep`, `tm comment`, `tm ac`. Do not leave active work
   in todo, and do not leave finished work open.
6. **Finish deliberately** — `tm accept <id> <n>` per criterion, `tm evidence <id> <path>`, then
   `tm done <id>`. Epics close when their children do (`autoCloseEpics`).
7. **Reconcile when picking up old items.** Audit whether status still matches the repo and merged
   PRs, and correct stale state as part of the work.

## Agents and dispatch

`tm dispatch <id>` hands a task to a worker (claim, start, worktree, spawn); `tm collect <id>` pulls
the result back. **The store gets the last word** — a worker reporting done on a task the store does
not show as done is downgraded to failed with the real status named. `tm agent list` is the worker
registry; `tm pool` is the opt-in pickup loop, off unless `dispatch.enabled` is true.

## Board

`tm board` in the terminal, `tm tm-dashboard` for the live board. Native Claude `TaskCreate`/
`TaskUpdate`, Grok `todo_write` and Codex `update_plan` calls are mirrored into the store
automatically by the harness bridge — you do not need to double-enter them.

## Outside contributions

GitHub remains the source for code, PRs, releases and CI. If an outside contributor opens a GitHub
Issue, triage it by creating a `tm` task and closing the issue with a pointer comment
(`Tracked as TM-N`). Do not open GitHub Issues for planning.
