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
is what lets claims stop two parallel sessions grabbing the same task.

**Which session?** `CLAUDE_CODE_SESSION_ID` — the variable Claude Code sets, in hooks and in
stdio MCP servers alike. `CLAUDE_SESSION_ID` is accepted second, as an override for a wrapper or
CI job driving `tm` outside Claude Code. Everything that distinguishes one thread from another
reads this: the claim interlock, the Stop gate, subagent attribution, and the `session` column on
every event. The plugin refuses to
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
| `Edit` / `Write` / `MultiEdit` / `NotebookEdit` | the edited file is recorded on the task the session holds, so `touches` fills itself |
| `git commit` / `gh pr create` | SHA or PR URL attached — by id in the message, or inferred from a `tm/TM-014-…` branch |
| `AskUserQuestion` answered | A real multi-option decision becomes an ADR (with its rejected options); clarifications are ignored |
| A subagent **starts** | It is briefed on the task the parent holds and what is left to satisfy — a spawned agent gets no SessionStart block |
| A subagent **starts** | It is told which tasks the parent already holds and what is left to meet on them, so a fan-out is not briefed from scratch |
| A subagent finishes | The tasks the parent holds are attributed to it, with the agent's `agent_id`, `agent_type` and its own transcript path, so parallel agents are visible |
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
tm reopen <id> [why]                 bring a done task back, and its epic with it
tm goal import <doc.md|*.plan.json>  a goal doc becomes a task; a manifest becomes a whole epic
tm dep <id> [-]<blocker>...          dependency graph; a leading - removes
tm evidence <id> <path|->            attach a log/screenshot as proof
tm task new "<title>" --template bug   start from a template
tm next | board | stale | standup      read the board  (add --json to any of these)
tm find <words> [field:value]...      search; a leading - negates a filter
tm show <id>                         one entity in full
tm why <id>                          what is actually holding a task up
tm graph [--epic EP-1] [--all]       the dependency graph as Mermaid
tm time [id]                         cycle time, median/mean, oldest open
tm log [n] | tm log <id>             the event tail, or one entity's whole history
tm standup [iso] | handoff <id>      digest / self-contained brief for another agent
tm export [md|csv|json]              the board out; --epic, --status, --open, --out <file>
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

## Goals

`/goal` is Claude Code's persistent-agent loop: plan → act → test → review → iterate, auto-continuing
when a turn ends and the goal is not met. It requires a **verifiable stop condition**. This plugin
refuses to close a task until every **acceptance criterion** is ticked. Those are the same
requirement, and a goal doc has already written it down:

```
$ tm goal import docs/goals/acp-pod-A1-codex-image.md
TM-014 Bake the Codex harness into the agent-devpod image so codex runs inside the pod [EP-002]
   5 acceptance criterion/criteria from the goal's own success criteria
   `tm done TM-014` now refuses until every one is ticked
```

Two shapes are read. The **doc** form is what `bytedesk-goals`' `plan_goal` writes — a `# Goal:`
heading and a success-criteria list. The **contract** form is the 5-part block you paste into the
`/goal` composer, where `**Stop when:**` *is* the verifiable condition and so becomes the criterion,
and `**Validate:** \`cmd\`` is kept because that is the command whose output `tm evidence` stores.
The Jira key is lifted out of the heading, and the objective, constraints and read-first notes are
kept in the body — `bytedesk-goals` **deletes** a goal doc once it is done, so the store cannot
merely point at it.

The parser is measured against all **555** goal docs found *recursively* under `docs/goals`, because
there is no single format: several header spellings (`## Success criteria (verifiable)` 178,
`## Success criteria` 82, `## Goal (verifiable success criteria)` 8, the bolded inline form, one-off
qualifiers) and two item forms in roughly 2:1 dash-to-numbered.

**530 parse; 25 are refused** — and every one of those is a README, CONTEXT, EPIC, JIRA-SCAFFOLD or
audit note rather than a goal. Refusal is the point: a task created with an empty acceptance list
passes `tm done` unchallenged, so a silent import would have the gate certify a goal nobody
verified. The refusal names the file and every header it looked for.

Two failure modes matter here and they are not symmetrical. Zero criteria is **refused**. A
*truncated* or *inflated* list is worse, because both look like a successful import and the gate
then closes on the wrong thing — so a fence inside a criterion cannot end the list, and a nested
sub-bullet folds into its parent rather than becoming a peer a gate could satisfy on its own.

### A whole program at once

`tm goal import <manifest.plan.json>` takes a `bytedesk-goals` manifest and lands the program:

```
$ tm goal import docs/goals/agent-capability-enhancements.plan.json
EP-003 Agent Capability Enhancements — Collaboration, Self-Learning & Memory…
   20 task(s) from 20 goal(s), 14 dependency edge(s)
   20 carry declared touches — `tm parallel` batches on those
   integration gate: scripts/testing/local-test.sh pr-ready
   `tm next` and `tm parallel` now answer for this program
```

Two manifest fields land somewhere that already existed and was starving. `dependsOn` becomes a
tm dependency — it is a *land* dependency in `run-goals` (a merged PR), which is the same shape as
tm's "blocker resolved" — so `tm next` and `tm why` answer correctly on an imported program with no
further input. And **`touches` becomes `touches`**, the field `tm parallel` batches on: nothing wrote
it until the Edit/Write hook began observing edits, and a manifest has it *declared* for 498 of the
506 goals in `bytedesk-platform`. So parallel batching is right **before** any work starts rather
than after a pass of it.

A goal whose doc has no parseable criteria is **skipped and named**, never imported with an empty
gate. Skipping rather than refusing the whole manifest is deliberate — one sloppy doc should not
cost the other nineteen goals — but the exit code is 2 when anything was skipped, so a script
notices. Dependencies are wired after every task exists, because a manifest lists goals in planning
order and `dependsOn` points forward freely.

## The board as context you pull

Everything above puts the board in front of Claude by *pushing*: SessionStart injects a summary,
PreCompact re-injects it, and the tools fire only when the model decides to call one. MCP
**resources** are the other direction — you attach them, before the first token:

```
@…:tm://board      the whole board          @…:tm://graph      dependency graph as Mermaid
@…:tm://session    the SessionStart block   @…:tm://blocked    everything stuck, to the root
@…:tm://standup    the last 24 hours        @…:tm://handoff/TM-014   one task's brief
```

Three reasons these are not just `tm_board` again: **who decides** (a resource is attached by
you, a tool fires if the model chooses to), **shape** (`tools/call` wraps everything as a JSON
string with escaped newlines; a resource arrives as `text/markdown`), and **capability** —
`tm://graph` and `tm://blocked` have no tool behind them at all, and `tm://session` is the one
view compaction destroys that nothing else rebuilds.

Only **computed** views are exposed. A task, epic or ADR is a markdown file that `Read` and `@`
already reach, so a `tm://task/TM-014` would be a URI alias for a file path competing with the
real file in the picker. `tm://handoff/<id>` is here because a handoff brief is assembled from
the task, its epic and its blockers — it exists nowhere as a file.

The picker lists work in flight and startable work (capped at 20), but **any** valid id reads:
nothing in the protocol requires a URI to have been listed. Content is truncated at 64k
characters rather than dropping an unbounded payload into a context window.

Not implemented, deliberately: `subscribe` and `listChanged`. Both need unsolicited writes to
stdout, which means subscription state and a writer threaded into `handleRequest` — and that
pure request-in/response-out contract is what makes the whole protocol testable without a
process. Every resource renders live at read time, so there is nothing to invalidate.

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

A task's `touches: []` is what `tm parallel` uses to decide which work can run at the same
time — and it is **filled in by watching, not by asking**. A `PostToolUse` hook on
`Edit`/`Write`/`MultiEdit`/`NotebookEdit` records the file that was just edited against the task
the session is holding, so after one pass of real work the store knows what collides with what.
`tm touches <id> [path...]` reads it, or declares paths ahead of time.

It attributes to a task it is **sure** about, or to nothing at all: the branch (`tm/TM-014-…`)
first, then the single task in progress, then the claim this session holds. Two tasks running in
one session is genuinely ambiguous and the edit is dropped — a path recorded against the wrong
task is worse than a missing one, because it invents a collision that serializes work *and*
hides the real collision on the task that owns the file. Paths are relative to the checkout
(so the same file in two worktrees is the same path), the store's own files are ignored, failed
edits say nothing, and the list is capped at 40. `tm config trackTouches false` turns it off.

> Before this, nothing wrote the field. So `touches` was empty everywhere, every task looked
> disjoint from every other, and `tm parallel` would put two tasks that rewrite the same file in
> one batch and tell you to run them side by side — the exact collision it exists to prevent. Claims carry session, worktree and branch, and expire — a session
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
tm ac <id> "<criterion>" | ac <id> --rm <n>  add or remove one
tm accept <id> <n> [--undo]                  tick, or put a mis-tick back
tm edit <id> "<title>" [--body <text|->]      correct what `new` got wrong
tm move <id> <EP-nnn|none>                   refile under another epic
tm assign <id> <who>              tm label <id> ui -stale     (a leading - removes)
tm priority <id> highest|high|medium|low|lowest
tm type <id> bug|story|task|spike|chore   issue type; `parent` expresses subtask-ness
tm estimate <id> <points>         tm comment <id> "<text>"
tm subtask <id> <parent|none>     tm link <id> "blocks" <id>  (writes both ends)
tm rank <id> --before|--after <id>            tm backlog
```

Links are mirrored automatically — `A blocks B` gives B `blocked by A`, because a one-sided
link is invisible from the end you're usually looking at. Dependencies work the same way and are
removable with a leading `-`, the same convention `tm label` uses. A dependency that would close a
**cycle is refused** at the point of writing rather than reported afterwards — `tm doctor` finds
cycles and deliberately will not repair them, since which edge to cut is a judgement, so the cheap
moment to say no is before one exists. A loop that already exists elsewhere is not blamed on the
next caller; doctor still reports it. Subtask nesting refuses cycles.
Backlog ranks are sparse integers, so dragging a card rewrites one file, not the whole board.

## Briefing a subagent

`SessionStart` fires once per session, not per agent, so a spawned subagent knew nothing about the
board: not that one existed, not which task its parent was working, not what "done" meant for it. It
re-derived context the parent already had, or filed a duplicate for work already tracked.

`SubagentStart` now returns the parent's claimed work as `additionalContext`:

```
## task-management — what this session is already working on

The parent session holds TM-001 "wire the vendor SDK" (EP-001).
Not yet met:
- [ ] the token refresh path is covered by a test

The parent holds the claim, so do not run `tm start`, `tm done`, `tm park` or `tm block` on these —
report what you found and let the parent record the outcome. Reads (`tm show`, `tm board`, `tm find`)
and additive notes (`tm comment`, `tm evidence`) are fine.
```

**Only the unticked criteria**, because a met one is settled and the agent's job is what is left.
**Nothing at all when the parent holds nothing** — a brief injected into every fan-out regardless is
a tax every agent pays for the case where it happens to matter. **Bounded** at 3 tasks, 5 criteria
each and 1200 characters, and it says how many claims it left out rather than truncating silently.

It is deliberately not `handoff()`. That is a cold-start dossier for someone picking a task up with
nothing in hand, and it ends with `Resume with: tm start <id>` — exactly wrong advice here, since
the parent already holds the claim and the interlock would refuse.

## Briefing a spawned agent

`SessionStart` fires once per session. A subagent spawned mid-session got none of it, so it knew
nothing about the board — not which task its parent was working, not what "done" meant for it — and
could file a duplicate for work already tracked.

`SubagentStart` fires per agent, carries the **parent's** `session_id`, and takes `additionalContext`
back. The plugin answers it with a short brief:

```
## task-management — what this session is already working on

The parent session holds TM-018 "credential configuration through the UI" (EP-001).
Not yet met:
- [ ] the operator can set a provider key without editing a file

The parent holds the claim, so do not run `tm start`, `tm done`, `tm park` or `tm block` on these —
report what you found and let the parent record the outcome. Reads (`tm show`, `tm board`, `tm find`)
and additive notes (`tm comment`, `tm evidence`) are fine.
```

**Not the handoff dossier.** `tm handoff` is for picking a task up cold — epic body, evidence,
commits, branch, worktree — and it ends with `Resume with: tm start <id>`, which is exactly wrong
here: the parent already holds the claim, and an agent following that advice earns a refusal. A
subagent is handed its slice in the prompt; what it lacks is orientation and a guardrail.

**Nothing claimed means no output at all**, not an empty envelope — this text is prepended to every
agent in a fan-out, so a twelve-agent sweep would pay for it twelve times. It is capped at 3 tasks,
5 unmet criteria each and 1200 characters, and says how many tasks it left out rather than
truncating silently. Met criteria are dropped: what an agent needs is the part of "done" still
outstanding.

It opens with its own `##` heading because every `SubagentStart` hook's `additionalContext` is
concatenated into one block — without one, the brief runs into whatever the previous hook emitted.

## Standup

`tm standup [iso]` (default: the last 24h) answers the three questions a standup answers — what got
finished, what is being worked on, what is stuck — with the **status path** per item and the stop
reason on anything blocked or parked. Work that moved no status is listed last, summarised by what
did happen to it, because a day of comments and commits is real work.

It shares its collapsing with `tm log` and with the dashboard's activity panel: a status-changing
write reads as `→ blocked`, and a generic `update` that a specific event in the same second already
explains is dropped. The panel gets the sentence for each event kind from the store's own catalog
over `/api/events`, so all three surfaces describe the same event the same way.

## Settings

Board preferences are stored in the repo's own config, next to the tasks, so they follow the project
rather than the browser — open the same board on another machine and your notification categories,
your name and your layout are already set.

The **Settings** modal holds them; the **profile** menu next to it shows who the board thinks you
are, which is what decides whether a change counts as your work.

Writable keys are an allowlist. The gates — `enforce`, `wipLimit`, `requireAcceptance` — are not
board preferences and stay with `tm config`: a browser tab is not the place to switch off the rules
the CLI and the hooks enforce. The notification *permission* is a browser grant and cannot be
stored for you, so the modal asks for it rather than pretending.

`localStorage` is kept as a cache so the board renders instantly and still works offline; the repo's
copy wins as soon as it arrives.

## The task drawer

Opening a card gives a drawer that is a grid — a header row that stays put and a body that scrolls.

The header carries the identity: id, status, the thread holding it, its epic, and the title field.
It is outside the scrolling region on purpose, because scrolling back to remember which task you are
reading is a tax on every long one. The body is grouped into sections separated by a rule, rather
than one column of controls.

`overscroll-behavior: contain` on the body stops a scroll that reaches the end from chaining to the
board underneath — before this the drawer had no scroll at all, so a wheel over it moved the board
and the bottom of a dense task was simply unreachable.

`tests/browser/drawer.mjs` measures all of that in a real browser at a short viewport. It is not part
of `run-tests.sh` — it needs Chrome and a served build — so run it by hand after touching the drawer:

```
npm --prefix dashboard run build
node tests/browser/drawer.mjs
```

## Acceptance criteria are not a one-way door

`tm done` is gated on the list, so a stray tick or a typo'd criterion changes what the tool will
accept. Ticking existed on all three surfaces and unticking on none — the dashboard's checkbox even
set `isDisabled` once checked, locking the box it had just ticked — and nothing anywhere could remove
a criterion. The only way back was editing the frontmatter by hand.

```
tm accept <id> <n>            tick
tm accept <id> <n> --undo     put a mis-tick back
tm ac <id> --rm <n>           remove one that should never have been there
```

The board's checkbox toggles, and each criterion has a ✕. Over MCP it is one tool: `tm_ac_accept`
with `undo` or `remove`.

Unticking **does not reopen a task that is already done**. That is a decision, not an invariant — the
work may genuinely be finished and the criterion simply mis-ticked — and `tm doctor` already reports
that state as `done-unmet` and declines to auto-repair it for the same reason. The CLI says so when
it happens rather than acting on your behalf.

Removing **renumbers what follows**, so every surface returns the surviving list: "AC 4" in an older
commit message now points at a different sentence.

## Why a card stopped

`tm park <id> <why>` and `tm block <id> <why>` store the sentence you type, and both boards show it
— on the CLI line right after the title, and on the dashboard card as its own line of prose. `tm
show` prints it unabridged; the board clamps it and ends in `…`, because a board is for scanning and
`tm show`/`tm why` are where the whole thing lives.

It is shown only while it applies: `tm start` on a parked task does not clear `parkedReason`, and a
task that is being worked on is not waiting on anything.

## Searching

Bare words are a case-insensitive substring over titles and bodies. `field:value` narrows, and a
leading `-` negates:

```
tm find status:in_progress priority:highest
tm find assignee:ryan -label:stale
tm find epic:EP-002 type:bug "the half-remembered title"
tm find -assignee:                     # the unassigned queue
```

Fields: `status`, `epic`, `assignee`, `actor`, `priority`, `type`, `label`, `kind`, `id`. Every
filter **ANDs**, including a repeated key — `label:ui label:perf` is "has both", and OR is running
the search twice. `tm_find` takes the same query as one string, so an agent can ask the board a
question instead of reading the whole board and filtering it itself.

This is deliberately **not JQL**: no operators, no precedence, no parentheses, no ORDER BY. It is
the `key:value` syntax `gh search` and GitHub's search box already use, because a query language
needs a parser, an error surface and a manual of its own.

An unrecognised field is **refused**, listing the ones that exist — `assigne:ryan` quietly
returning every task whose body contains that string is a wrong answer that looks like a right one.
A token whose value starts `//` stays a search term, so a PR url does not parse as a filter on the
field `https`.

The board in the browser has always had these filters, plus saved views. The terminal and the agent
had a substring match, which meant "what is assigned to me and still open" was answerable only on
the one surface an agent cannot use. The two field sets are held together by a test that reads
`dashboard/src/filters.ts` at test time, since the SPA imports nothing from `lib/`.

`edit` and `move` exist because every *other* field had a verb and the two you type first did not.
A retitle **keeps the file name** — `TM-001-typoed-titel.md` gains the corrected title inside —
because the id is the identity and the slug is decoration: a rename is a delete-plus-add in git
that breaks blame on the entity's whole history, and the old path may already sit in a commit
message or an evidence ref. Re-submitting a value that is already stored writes nothing, so an
`updated` stamp still means the task actually moved.

`move` is not just a field write, because both epics' lifecycles depend on their children. Into a
`done` epic, an unfinished task **reopens** it — a finished epic holding live work is the lie
`tm reopen` already refuses to leave behind, and the auto-close will never re-close it on its own.
Out of an epic, the source gets the same **auto-close** check that finishing a task there would
give it; an epic emptied entirely stays open, because zero tasks is not an achievement.

All three surfaces do both now — `tm edit`/`tm move`, `tm_task_edit`, and `PATCH /api/task/:id`,
which previously took title and body only. That last gap meant the board could file a task under
the active epic and never move it out again.

**`tm next` is ordered by them.** An explicit `rank` first, in rank order — a rank is only ever
set by deliberately placing that task relative to another, which is a stronger statement than a
label, and it is Jira's rule too. Everything unranked follows by `priority`, with an unset
priority read as `medium`. Id breaks the remaining ties, so the order is total and the same board
never renders two ways. The rendered line shows `!<priority>` when one is set, because a list
whose order has no visible reason is a list you cannot trust.

This is the order every caller of `next` gets: the `tm next` verb, the SessionStart context
block, the `tm_next` MCP tool, the `@`-mentionable resource list, and `tm parallel`. The sort is
inside `nextTasks`, not at those five call sites — an order each caller has to remember to apply
is an order some caller will not have.

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
```

`--epic EP-1` · `--status blocked` · `--open` (drop done work) · `--out <file>` (default stdout, so it pipes).

**md** is a report you can paste into a PR or a standup: epics with progress, each task with
its criteria ticked or not, what a blocked task is waiting on, commits, evidence, and a cycle-time
line at the top. Tasks with no epic get their own section rather than being dropped.

**csv** is RFC 4180 with Jira's column names and Jira's status vocabulary, so an import needs no
remapping. Quoting is the whole correctness surface here — a task titled `fix the "done" gate,
properly` shifts every later column of its row if you get it wrong, and the file still opens — so
the escaping is tested against a hostile title, a multi-line body, and multi-line criteria.

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

`missing-evidence` only looks at refs it can resolve on disk. `tm evidence` copies the file
into the store, so its refs are store-relative and checkable; a hand edit can put anything
probative there instead — the url of the PR, an absolute path to a log outside the repo, an
opaque handle to a browser session. A ref with a scheme is left alone rather than reported,
because this finding's fix **deletes** what it reports, and dropping the url that proves the
task is a worse outcome than the untidiness the check exists to catch.

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
| `trackTouches` | `true` | record edited files on the claimed task (what `tm parallel` batches on) |
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
