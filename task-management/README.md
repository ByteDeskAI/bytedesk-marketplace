# task-management

Claude Code's native task state is per-session and ephemeral — it lives in
`~/.claude/tasks/session-<id>/` and dies with the session. Approved plans land in
`~/.claude/plans/<random-name>.md`, outside your repo, linked to nothing.

This plugin takes those surfaces over. Every `TaskCreate` / `TaskUpdate`, every approved
plan, every decision, and every commit is mirrored into a **git-tracked markdown store**
at `.bytedesk/task-management/` — so the board survives sessions, compaction, worktrees,
and machines, and your teammates can read it in a PR diff.

```
/plugin marketplace add ByteDeskAI/bytedesk-marketplace
/plugin install task-management@bytedesk
```

Then, in any repo: `tm init` (or just let the first `/task-management:epic` do it).

### The `tm` command

The first session after install links `tm` and `tm-dashboard` into `~/.local/bin` for you
(`TM_BIN_DIR` to point elsewhere) and says so once. It only does this when the directory
exists and nothing else owns the name — if something does, it tells you instead of
clobbering it. Opt out with `TM_NO_AUTOLINK=1`, or drive it yourself:

```bash
./install.sh              # or: node bin/tm install
./install.sh --force      # take the name from whatever has it
./install.sh --uninstall  # remove our symlinks only
tm where                  # store path, link state, PATH check
```

The plugin works fine without any of this — the hooks call `bin/tm` by absolute path.
The symlink is purely so *you* can type `tm board`.

## What it does

**Persists.** One markdown file per entity, frontmatter + body:

```
<project>/.bytedesk/task-management/
  epics/EP-001-close-the-memory-gaps.md
  tasks/TM-014-add-cursor-pagination.md      acceptance criteria, evidence, commits, deps, touches
  adrs/ADR-0007-markdown-is-the-source-of-truth.md
  plans/2026-07-25-close-the-memory-gaps.md  copied out of ~/.claude/plans
  templates/{bug,spike,chore}.md             starters for `tm task new --template`
  evidence/TM-014-vitest.log
  events.jsonl    append-only audit — every write goes through it (rotates at 5 MB)
  index.json      derived cache; delete it any time, `tm reindex` rebuilds
  state.json      active epic, session claims, one-shot overrides
  config.json     gate policy
<project>/.bytedesk/worktrees/TM-014-…/       isolated checkouts, heavy artifacts shared
```

**Which project?** `TM_ROOT` → the executing project (`CLAUDE_PROJECT_DIR`) → the cwd's repo.
Every **git worktree of a project shares one store** (resolved through `--git-common-dir`), which
is what lets claims stop two parallel sessions grabbing the same task. The plugin refuses to
create a store inside its own repo — set `TM_ROOT` if you're deliberately dogfooding it.

**Captures**, via hooks — no discipline required:

| When | What happens |
|---|---|
| Session starts | Open epic, in-progress claims, stale work, and next unblocked tasks are injected into context |
| **Context is about to compact** | The board is re-injected — compaction is exactly when task state evaporates |
| You submit a prompt | If it matches open work, that task is surfaced so nothing gets duplicated |
| `TaskCreate` | Denied unless an epic is active and you're under the WIP limit |
| `TaskCreate` / `TaskUpdate` | Mirrored into the store with session, branch, worktree, and dependencies |
| Plan approved (`ExitPlanMode`) | Plan copied into the repo, an epic opened and linked |
| `git commit` / `gh pr create` | SHA or PR URL attached — by id in the message, or inferred from a `tm/TM-014-…` branch |
| `AskUserQuestion` answered | A real multi-option decision becomes an ADR (with its rejected options); clarifications are ignored |
| A subagent finishes | Its work is attributed on the timeline, so parallel agents are visible |
| Session tries to stop | Blocked while tasks you claimed are still `in_progress` |
| Session ends | Abandoned `in_progress` work is parked with a reason and its claim released |

**Enforces** — and gets out of the way. `TM_ENFORCE=off` disables every gate,
`tm override "<reason>"` bypasses exactly one (logged, with the reason), and the Stop gate
never blocks twice in a row on the same tasks.

## CLI

```
tm init                              create the store in this repo
tm epic new "<title>" | use <id>     epics gate task creation
tm task new "<title>"                dup-guarded; files under the active epic
tm ac <id> "<criterion>"             acceptance criteria — `tm done` refuses without them
tm accept <id> <n>                   tick one
tm start|done|park|block|unblock <id>
tm dep <id> <blocker...>             dependency graph
tm evidence <id> <path|->            attach a log/screenshot as proof
tm task new "<title>" --template bug   start from a template
tm next | board | stale | find <q>   read the board  (add --json to any of these)
tm show <id>                         one entity in full
tm time [id]                         cycle time, median/mean, oldest open
tm log [n] | tm log <id>             event tail, or one task's whole history
tm standup [iso] | handoff <id>      digest / self-contained brief for another agent
tm reindex | config [k v] | override "<why>" | migrate
```

### Parallel work

```
tm parallel [--epic EP-1]            batches of unblocked, unclaimed, non-colliding tasks
tm worktree new <id> [--base ref]    isolated checkout + branch, heavy artifacts shared
tm worktree list | rm <id> | share <id>
tm claim <id> [--steal] | release <id> | sweep
tm start <id> [--steal]              refuses a task another live session holds
tm handoff <id> --worktree           brief that provisions its own checkout
```

A task's optional `touches: []` (paths it will edit) is what `tm parallel` uses to decide which
work can run at the same time. Claims carry session, worktree and branch, and expire — a session
that never comes back cannot lock a task out of the board forever.

### Sharing heavy artifacts between worktrees

A new worktree gets `node_modules` **symlinked** and `.env` **copied** by default, so it is usable
immediately and costs kilobytes instead of a reinstall. Configure with `worktreeShare`:
`[{path, mode}]` where mode is `symlink`, `copy` or `hardlink`; `**/node_modules` matches every
package in a monorepo. Tracked paths are never shared (a symlink over a tracked file would get
committed), nothing already in the worktree is clobbered, and `tm worktree rm` unlinks the shares
before removing — your main checkout's `node_modules` is never at risk.

**The tradeoff:** a symlinked `node_modules` is shared mutable state — `pnpm install` in one
worktree changes them all. Right default for parallel agents reading one dependency tree, wrong
one for a task that changes dependencies. Use `mode: copy` or `--no-share` there.

## MCP

`.mcp.json` registers a stdio server (`bin/tm-mcp`) so Claude queries the store as typed tools
rather than parsing CLI text — `tm_board`, `tm_next`, `tm_show`, `tm_find`, `tm_task_create`,
`tm_task_update`, `tm_ac_add`, `tm_evidence`, `tm_handoff`, `tm_claim` and friends. The gates apply
identically over MCP: `tm_task_create` with no active epic returns the same denial the CLI gives.

## Jira-shaped fields

Tasks carry the fields you'd expect from an issue tracker, all optional and all in
frontmatter — a task with none of them set behaves exactly as it did before they existed:

```
tm assign <id> <who>              tm label <id> ui -stale     (a leading - removes)
tm priority <id> highest|high|medium|low|lowest
tm estimate <id> <points>         tm comment <id> "<text>"
tm subtask <id> <parent|none>     tm link <id> "blocks" <id>  (writes both ends)
tm rank <id> --before|--after <id>            tm backlog
```

Links are mirrored automatically — `A blocks B` gives B `blocked by A`, because a one-sided
link is invisible from the end you're usually looking at. Subtask nesting refuses cycles.
Backlog ranks are sparse integers, so dragging a card rewrites one file, not the whole board.

## Dashboard write surface

The board is not read-only. Every write goes through the same `lib/` functions the CLI calls,
so the gates, the event log and the markdown files stay authoritative no matter which surface
made the change — a transition to `done` from the dashboard runs the same acceptance gate, takes
the same claim, fires the same dependency unblock and closes the epic the same way.

| Route | Does |
|---|---|
| `POST /api/task` | create (honours the active-epic gate) |
| `PATCH /api/task/:id` | edit title/body |
| `POST /api/task/:id/transition` | status change, with claim + gate + unblock + epic auto-close |
| `POST /api/task/:id/{assign,labels,priority,estimate,comment,link,subtask,rank,ac,accept}` | field writes |
| `POST /api/bulk` | one op across many ids, partial success reported per id |
| `GET /api/board` · `GET /api/backlog` · `GET /api/events` · `GET /events` (SSE) | reads |

Refusals carry the CLI's own wording: a gate says no with **409** and the reason, bad input is
**400**, a missing task is **404**. The UI shows that text rather than a generic failure.

## Skills

`/task-management:epic` · `board` · `adr` · `handoff` · `standup` · `groom` · `override`

## Dashboard

Starts automatically while the plugin is enabled (a `plugin-active` monitor). Live SSE board,
port in `.bytedesk/task-management/dashboard.port` (default 7910, `TM_DASHBOARD_PORT` to change).
Run it by hand with `bin/tm-dashboard`.

## Config

`tm config` prints the current policy; `tm config <key> <json>` sets one.

| Key | Default | Effect |
|---|---|---|
| `enforce` | `true` | master switch for every gate |
| `requireEpic` | `true` | `TaskCreate` needs an active epic |
| `requireAcceptance` | `true` | `tm done` needs all criteria ticked |
| `wipLimit` | `3` | max concurrent `in_progress` |
| `staleMinutes` | `90` | when `in_progress` starts being called stale |
| `gitLink` | `true` | attach commits/PRs automatically |
| `captureDecisions` | `"smart"` | `"smart"` records real decisions only; `true` records every question; `false` none |
| `autoCloseEpics` | `true` | close an epic when its last child is done |
| `claimTtlMinutes` | `240` | when a claim from a vanished session expires |
| `parkOnSessionEnd` | `true` | park abandoned `in_progress` work when a session ends |
| `eventMaxBytes` | `5000000` | rotate `events.jsonl` past this size |
| `worktreeShare` | node_modules, .env | what a new worktree shares from the main checkout |
| `worktreeDir` / `branchPrefix` | `.bytedesk/worktrees` / `tm/` | where worktrees live and how branches are named |

## Tests

```bash
./run-tests.sh            # node:test units + every bash contract suite
./run-tests.sh unit       # just the units
./run-tests.sh contract   # just the bash suites
```

Units cover `lib/` (`node --test`, Node 22 built-in); the bash suites cover hook I/O, the CLI, real
git worktrees, the MCP handshake and the dashboard. Everything self-isolates in a `mktemp -d`
store — no fixtures, no network, no Claude Code needed.

## Notes

- The store is per-workspace, resolved as `TM_ROOT` → git toplevel → `CLAUDE_PROJECT_DIR` → cwd,
  so a worktree keeps its own board.
- Markdown files are the source of truth. `index.json` is disposable.
- Commit `.bytedesk/task-management/` — that's the point. One file per entity keeps merges sane.
- Not related to the `project-management` plugin in this marketplace, which is a heavier
  local Jira/Confluence with sprints, docs, and an MCP server. `tm export` (v1.1) will feed it.
