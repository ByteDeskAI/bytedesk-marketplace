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
tm why <id>                          what is actually holding a task up
tm graph [--epic EP-1] [--all]       the dependency graph as Mermaid
tm time [id]                         cycle time, median/mean, oldest open
tm log [n] | tm log <id>             event tail, or one task's whole history
tm standup [iso] | handoff <id>      digest / self-contained brief for another agent
tm export [md|csv|json|pm]           the board out; --epic, --status, --open, --out <file>
tm doctor [--fix]                    what is inconsistent, and repair the unambiguous half
tm reindex | config [k v] | override "<why>" | migrate
```

### Why is this blocked?

`blockedBy` stores **direct** blockers and nothing reads it transitively, so a card saying
`⊘ TM-002` doesn't tell you that TM-002 is waiting on TM-003, parked last week with a reason
nobody has re-read. `tm why` walks to the bottom and reports the reason at each hop:

```
$ tm why TM-001
TM-001  rotate the credential
status: blocked   startable: no

✗ waiting on 2 unresolved blockers (direct: TM-002)

chain:
  ⊘ TM-002 stand up the secret store  blocked
    ⏸ TM-003 get legal sign-off  parked — "waiting on counsel"

start here: TM-003
```

It answers for every reason a start would be refused, not just dependencies: a claim another
session holds, a hand-written `tm block` reason, the WIP limit, a dependency cycle, or a
`blockedBy` pointing at a task that doesn't exist. `parked` is reported but **not** counted as
blocking, because `tm start` resumes a parked task — conflating the two is how a "why" command
starts lying. `startable: yes` means `tm start` will succeed. `roots` (in `--json`) is the work
at the bottom of the chain; a dangling reference never appears there, since it is a broken
record rather than a task you can pick up.

`tm graph` draws the same edges as Mermaid, which GitHub renders **inside the PR diff** — the
whole point of a markdown store is that a reviewer can read the board, and a dependency graph
is the part that was previously unreadable. `--epic` scopes it (blockers from outside the epic
are still drawn, because they still explain the block), `--all` includes done work, `--raw`
omits the code fence, `--json` gives `{nodes, edges}`.

Over MCP: `tm_why`.

### Parallel work

```
tm parallel [--epic EP-1]            batches of unblocked, unclaimed, non-colliding tasks
tm worktree new <id> [--base ref]    isolated checkout + branch, heavy artifacts shared
tm worktree list | rm <id> | share <id>
tm claim <id> [--steal] | release <id> | sweep
tm start <id> [--steal]              refuses a task another live session holds
tm handoff <id> --worktree           brief that provisions its own checkout
```

Every write to an entity is serialized through one lock in the shared store, so two sessions
writing at the same instant cannot lose each other's changes — which is not a theoretical
concern here, since running several at once is the point. `create` mints an id and writes it
atomically (otherwise two sessions pick the same number and one file becomes unreachable), and
read-append-write edits — comments, labels, links, criteria, evidence, deps — go through
`mutate` so both appends survive.

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
rather than parsing CLI text — `tm_board`, `tm_next`, `tm_show`, `tm_find`, `tm_why`, `tm_task_create`,
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
| `POST /api/epic` | switch the active epic (`{id}`, or `{id: null}` to clear) |
| `GET /api/board` · `GET /api/backlog` · `GET /api/events` · `GET /events` (SSE) | reads |

Refusals carry the CLI's own wording: a gate says no with **409** and the reason, bad input is
**400**, a missing task is **404**. The UI shows that text rather than a generic failure.

## Skills

`/task-management:epic` · `board` · `adr` · `handoff` · `standup` · `groom` · `override`

## Dashboard

Starts automatically while the plugin is enabled (a `plugin-active` monitor). Live SSE board,
port in `.bytedesk/task-management/dashboard.port` (default 7910, `TM_DASHBOARD_PORT` to change).
Run it by hand with `bin/tm-dashboard`.

## Getting the board out

```
tm export                            markdown report → stdout
tm export csv --out board.csv        spreadsheet, or a Jira CSV import
tm export json --events              the whole store as one document
tm export pm                         pm_issue_create payloads for the project-management plugin
```

`--epic EP-1` · `--status blocked` · `--open` (drop done work) · `--out <file>` (default stdout, so it pipes).

**md** is a report you can paste into a PR or a standup: epics with progress, each task with
its criteria ticked or not, what a blocked task is waiting on, commits, evidence, and a cycle-time
line at the top. Tasks with no epic get their own section rather than being dropped.

**csv** is RFC 4180 with Jira's column names and Jira's status vocabulary, so an import needs no
remapping. Quoting is the whole correctness surface here — a task titled `fix the "done" gate,
properly` shifts every later column of its row if you get it wrong, and the file still opens — so
the escaping is tested against a hostile title, a multi-line body, and multi-line criteria.

**pm** emits `pm_issue_create` payloads in that plugin's own field names, plus the follow-up
`transitions`: `pm_issue_create` always creates at `TODO`, so pretending one call carries status
would silently flatten the board. Each payload keeps `_source` and repeats the `tm` id in the
description, because an import you cannot trace back to the source board is a one-way door.
`parked` has no equivalent in pm, so it maps to `TODO` **and** adds a `parked` tag rather than
losing the state.

## When the store drifts

Markdown files as the source of truth is what makes the board readable and mergeable.
It is also why it drifts: a file gets hand-edited, a merge resolves one side of a
two-sided link, a task is deleted while three others still name it as a blocker, a
session dies holding a claim. `tm reindex` does not help — it rebuilds the cache **from**
the files, so it faithfully reproduces whatever is wrong with them.

```
$ tm doctor
## errors (2)
✗ TM-003    dangling-dep    blockedBy names TM-404, which does not exist  [fixable]
✗ TM-003    orphan-epic     epic EP-077 does not exist  [fixable]

## warnings (3)
! TM-001    one-sided-dep   TM-001 is blocked by TM-002, but TM-002 does not list it in blocks  [fixable]
! TM-001    one-sided-link  TM-001 "duplicates" TM-003, but TM-003 has no "duplicated by" back  [fixable]
! TM-001    missing-evidence  evidence/TM-001-proof.log is recorded but the file is gone  [fixable]

5 of 5 can be repaired automatically — `tm doctor --fix`
```

**error** means the store is lying — a read gives a wrong answer. **warning** means it is
untidy but correct. It **exits 1 on any error**, so it can gate a commit hook or a CI step.

`duplicate-id` is the one it will not repair. Two files claiming one id means only the first
is reachable at all, and deciding which keeps the id changes an identity that commits, links
and dependencies already point at — a judgement, not a typo. (Stores written before writes
were serialized may contain these; that is why it reports rather than guesses.)

`--fix` applies only what is unambiguous, says what it changed, and repeats until the store
stops changing — dropping a dangling blocker can leave a task `blocked` with nothing blocking
it, which is a different finding that only exists once the first is fixed. Some things are
never auto-fixed because they are decisions rather than typos: which edge of a dependency
cycle to cut, a `done` task with unticked criteria (ticking them would be forging evidence),
two tasks mirroring one native id, an `in_progress` task nobody claimed.

## Epics on the board

Epics were second-class on the dashboard: one lozenge in the header, and no way to
change which one was active — so the board could create tasks but not say which epic
they land in, which is the one decision governing everything it does next. The active-epic
selector in the toolbar does that now (`POST /api/epic`, same validation and same event as
`tm epic use`; a closed epic is refused rather than silently gating every later create).

**Group by epic** turns the five status columns into one row of columns per epic, with a
progress bar and `done/total` per lane. The active epic sorts first, then open epics by id,
then closed ones, then unfiled work — which is never dropped, because a task with no epic is
exactly the thing you want to notice. An epic id with no epic file gets a lane marked
`missing` rather than hiding the tasks behind the data fault (`tm doctor --fix` clears it).

The keyboard cursor still reads the same five columns whether or not the board is grouped:
grouping sorts tasks lane-first, so `j` keeps walking down the screen instead of hopping
between lanes.

> The header lozenge and the burndown chart previously showed
> `epics.find(e => e.status !== "done")` — "the first epic that isn't finished" — rather than
> the active epic in `state.json`, which the board payload had always carried. With one epic
> those coincide; with two, both pointed at the wrong epic.

## The board without a mouse

Cards used to move by HTML5 drag and nothing else, so half the write surface was
unreachable by keyboard and the rest was a hunt for which panel owned the control.

`?` lists every binding. The short version: `j`/`k` walk a column, `h`/`l` cross columns
(skipping empty ones), `g`/`G` jump to the ends, **`1`–`5` move the focused card to that
column** — the number is printed in each column heading, because the heading is the
shortcut — `[`/`]` reorder within a column, `x` selects for the bulk bar, `w` watches,
`o`/`Enter` opens, `c` creates, `/` searches.

`⌘K` / `Ctrl-K` opens a command palette over every board action and every visible task,
so "set this to blocked" is something you can type rather than somewhere you have to
find. It opens from inside a text field too.

Shortcuts go quiet while you are typing in a field or a dialog is up, and any modifier
chord that isn't `⌘K` is left to the browser — swallowing `⌘R` would be worse than having
no shortcuts at all. Cards are real focusable list items with `aria-label`s carrying what
the badges show, on a roving tabindex, so `Tab` and `j`/`k` agree on where the cursor is.

## Working on the dashboard

The board `bin/tm-dashboard` serves is the built bundle in `dashboard/dist/` (committed, so
the plugin works on a clone with no `npm install`). Editing `dashboard/src/` therefore changes
nothing until you rebuild — which is a slow way to move a card two pixels.

For live editing, run the Vite dev server **alongside** the normal board:

```bash
bin/tm-dashboard &                       # the API, the SSE feed and the store
npm --prefix dashboard run dev           # http://localhost:5173 — HMR
```

Edit anything under `dashboard/src/` and the browser updates without a reload or a restart.
The dev server proxies `/api` and `/events` to the running board, so you are editing the UI
against **live data from your real store** — not a fixture. It finds the port itself out of
`dashboard.port`, because that port is assigned per project and any hardcoded default is wrong
for every project but one. Point it somewhere else with `TM_API=http://127.0.0.1:<port>`.

Two things it will tell you rather than fail obscurely: with no board running it refuses to
start and says so (instead of starting and failing every request), and it treats a **stale**
port file — one left behind by a board that died — the same way, by checking the recorded pid
is alive. `npm run build` never needs a board.

When you are done, rebuild so the served bundle matches the source:

```bash
npm --prefix dashboard run build         # tsc --noEmit && vite build && the PWA assets
node tests/browser/keyboard.mjs          # and re-check the keyboard against the new build
```

`dashboard/src/*.mjs` (`keys.mjs`, `lanes.mjs`, `metrics.mjs`, `pwa/*.mjs`) are plain JavaScript
on purpose: they hold the logic, and `node --test` can reach them without a TypeScript runner.
The `.tsx` components stay thin so they need no test harness of their own.

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

One check is deliberately **outside** that suite, because it needs Chrome and a served build:

```bash
npm --prefix dashboard run build
node tests/browser/keyboard.mjs          # real key events, real browser, over CDP
```

It drives the board's keyboard and asserts the DOM — that focus follows the cursor, that the
ring is visible, and that typing `j` in the search field types a `j`. It skips cleanly when
there is no Chrome or no board running, so it never fails for being unrunnable.

## Notes

- The store is per-workspace, resolved as `TM_ROOT` → git toplevel → `CLAUDE_PROJECT_DIR` → cwd,
  so a worktree keeps its own board.
- Markdown files are the source of truth. `index.json` is disposable.
- Commit `.bytedesk/task-management/` — that's the point. One file per entity keeps merges sane.
- Not related to the `project-management` plugin in this marketplace, which is a heavier
  local Jira/Confluence with sprints, docs, and an MCP server. `tm export pm` feeds it.
