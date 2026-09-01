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

Then bootstrap the repository once with `node <installed-plugin>/bin/tm init` (or let the first
`/task-management:epic` do it). Every command after bootstrap uses the committed project launcher.

### Installing without Claude Code

Everything except Claude Code's own hooks works standalone — the CLI, the store, the MCP server and
the dashboard. This is the path, in order, verified from a clean `HOME` with the plugin copied out
of the marketplace and nothing symlinked back:

```bash
cd your-repo && node <plugin>/bin/tm init   # store + project launchers
.bytedesk/task-management/bin/tm epic new "First epic"      # a board needs an epic before it takes tasks
.bytedesk/task-management/bin/tm task new "first task"
.bytedesk/task-management/bin/tm-dashboard                  # serves the board; prints the URL it chose
```

Codex `.codex/hooks.json` should invoke `.bytedesk/task-management/bin/tm-hook`, written during
bootstrap. No global command or PATH setup is required.

`.bytedesk/task-management/bin/tm init` records the repo as the board's identity and your git user as its owner, so a clone knows
which project it belongs to and who set it up.

### The `.bytedesk/task-management/bin/tm` command

Bootstrap writes `tm`, `tm-hook`, and `tm-dashboard` under
`.bytedesk/task-management/bin/`, plus `.cmd` twins for Windows. They resolve the installed plugin
at runtime without committing a machine-specific path:

```bash
.bytedesk/task-management/bin/tm where       # launcher health and resolved plugin source
.bytedesk/task-management/bin/tm doctor      # report legacy launchers, links and config
.bytedesk/task-management/bin/tm doctor --fix # migrate recognized legacy state
```

Claude hooks and MCP servers continue to use their host-provided plugin root. Repository scripts,
Codex hooks, agents, and people use the project launchers.

## What it does

**Persists.** One markdown file per entity, frontmatter + body:

```
<project>/.bytedesk/task-management/
  epics/EP-001-close-the-memory-gaps.md
  tasks/TM-014-add-cursor-pagination.md      acceptance criteria, evidence, commits, deps, touches
  adrs/ADR-0007-markdown-is-the-source-of-truth.md
  plans/2026-07-25-close-the-memory-gaps.md  copied out of ~/.claude/plans
  templates/{bug,spike,chore}.md             starters for `.bytedesk/task-management/bin/tm task new --template`
  evidence/TM-014-vitest.log
  events.jsonl    this host's audit log — every write goes through it (rotates at 5 MB; not committed)
  index.json      derived cache; delete it any time, `.bytedesk/task-management/bin/tm reindex` rebuilds
  state.json      active epic, session claims, one-shot overrides
  config.json     gate policy
<project>/.bytedesk/worktrees/TM-014-…/       isolated checkouts, heavy artifacts shared
```

**Which project?** `TM_ROOT` → the executing project (`CLAUDE_PROJECT_DIR`) → the cwd's repo.
Every **git worktree of a project shares one store** (resolved through `--git-common-dir`), which
is what lets claims stop two parallel sessions grabbing the same task.

**Which session?** Whichever agent CLI is running: `CLAUDE_CODE_SESSION_ID` (Claude Code, in hooks
and stdio MCP servers alike), `CLAUDE_SESSION_ID` as a wrapper override, `CODEX_THREAD_ID` (Codex
CLI) or `GROK_SESSION_ID` (Grok). No variable set means no session — a bare shell or a CI job is
not silently treated as Claude Code. Everything that distinguishes one thread from another reads
this: the claim interlock, the Stop gate, subagent attribution, and the `session` column on
every event. The plugin refuses to create a store inside an *installed* copy of itself, under
`~/.claude/plugins` — `/plugin update` would wipe it. A source checkout is an ordinary project:
this repo tracks its own work with no `TM_ROOT` and no repo-local configuration.

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
`.bytedesk/task-management/bin/tm override "<reason>"` bypasses exactly one (logged, with the reason), and the Stop gate
never blocks twice in a row on the same tasks.

## CLI

```
.bytedesk/task-management/bin/tm init                              create the store in this repo
.bytedesk/task-management/bin/tm epic new "<title>" | use <id>     epics gate task creation
.bytedesk/task-management/bin/tm task new "<title>"                dup-guarded; files under the active epic
.bytedesk/task-management/bin/tm ac <id> "<criterion>"             acceptance criteria — `.bytedesk/task-management/bin/tm done` refuses without them
.bytedesk/task-management/bin/tm accept <id> <n>                   tick one
.bytedesk/task-management/bin/tm start|done|park|block|unblock <id>
.bytedesk/task-management/bin/tm reopen <id> [why]                 bring a done task back, and its epic with it
.bytedesk/task-management/bin/tm goal import <doc.md|*.plan.json>  a goal doc becomes a task; a manifest becomes a whole epic
.bytedesk/task-management/bin/tm dep <id> [-]<blocker>...          dependency graph; a leading - removes
.bytedesk/task-management/bin/tm cap new "<title>" [--area --impact --effort --confidence --source]
.bytedesk/task-management/bin/tm cap list [--status open]          the enhancement backlog, best bet first
.bytedesk/task-management/bin/tm cap accept <CAP-id>               mint the task that builds it, criteria and all
.bytedesk/task-management/bin/tm cap ship <CAP-id> | drop <CAP-id> shipping refuses without evidence
.bytedesk/task-management/bin/tm evidence <id> <path|->            attach a log/screenshot as proof
.bytedesk/task-management/bin/tm task new "<title>" --template bug   start from a template
.bytedesk/task-management/bin/tm next | board | stale | standup      read the board  (add --json to any of these)
.bytedesk/task-management/bin/tm find <words> [field:value]...      search; a leading - negates a filter
.bytedesk/task-management/bin/tm show <id>                         one entity in full
.bytedesk/task-management/bin/tm why <id>                          what is actually holding a task up
.bytedesk/task-management/bin/tm graph [--epic EP-1] [--all]       the dependency graph as Mermaid
.bytedesk/task-management/bin/tm time [id]                         cycle time, median/mean, oldest open
.bytedesk/task-management/bin/tm log [n] | .bytedesk/task-management/bin/tm log <id>             the event tail, or one entity's whole history
.bytedesk/task-management/bin/tm standup [iso] | handoff <id>      digest / self-contained brief for another agent
.bytedesk/task-management/bin/tm export [md|csv|json]              the board out; --epic, --status, --open, --out <file>
.bytedesk/task-management/bin/tm doctor [--fix]                    what is inconsistent, and repair the unambiguous half
.bytedesk/task-management/bin/tm reindex | config [k v] | override "<why>" | migrate
```

### Why is this blocked?

`blockedBy` stores **direct** blockers and nothing reads it transitively, so a card saying
`⊘ TM-002` doesn't tell you that TM-002 is waiting on TM-003, parked last week with a reason
nobody has re-read. `.bytedesk/task-management/bin/tm why` walks to the bottom and reports the reason at each hop:

```
$ .bytedesk/task-management/bin/tm why TM-001
TM-001  rotate the credential
status: blocked   startable: no

✗ waiting on 2 unresolved blockers (direct: TM-002)

chain:
  ⊘ TM-002 stand up the secret store  blocked
    ⏸ TM-003 get legal sign-off  parked — "waiting on counsel"

start here: TM-003
```

It answers for every reason a start would be refused, not just dependencies: a claim another
session holds, a hand-written `.bytedesk/task-management/bin/tm block` reason, the WIP limit, a dependency cycle, or a
`blockedBy` pointing at a task that doesn't exist. `parked` is reported but **not** counted as
blocking, because `.bytedesk/task-management/bin/tm start` resumes a parked task — conflating the two is how a "why" command
starts lying. `startable: yes` means `.bytedesk/task-management/bin/tm start` will succeed. `roots` (in `--json`) is the work
at the bottom of the chain; a dangling reference never appears there, since it is a broken
record rather than a task you can pick up.

`.bytedesk/task-management/bin/tm graph` draws the same edges as Mermaid, which GitHub renders **inside the PR diff** — the
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
$ .bytedesk/task-management/bin/tm goal import docs/goals/acp-pod-A1-codex-image.md
TM-014 Bake the Codex harness into the agent-devpod image so codex runs inside the pod [EP-002]
   5 acceptance criterion/criteria from the goal's own success criteria
   `.bytedesk/task-management/bin/tm done TM-014` now refuses until every one is ticked
```

Two shapes are read. The **doc** form is what `bytedesk-goals`' `plan_goal` writes — a `# Goal:`
heading and a success-criteria list. The **contract** form is the 5-part block you paste into the
`/goal` composer, where `**Stop when:**` *is* the verifiable condition and so becomes the criterion,
and `**Validate:** \`cmd\`` is kept because that is the command whose output `.bytedesk/task-management/bin/tm evidence` stores.
The Jira key is lifted out of the heading, and the objective, constraints and read-first notes are
kept in the body — `bytedesk-goals` **deletes** a goal doc once it is done, so the store cannot
merely point at it.

The parser is measured against all **555** goal docs found *recursively* under `docs/goals`, because
there is no single format: several header spellings (`## Success criteria (verifiable)` 178,
`## Success criteria` 82, `## Goal (verifiable success criteria)` 8, the bolded inline form, one-off
qualifiers) and two item forms in roughly 2:1 dash-to-numbered.

**530 parse; 25 are refused** — and every one of those is a README, CONTEXT, EPIC, JIRA-SCAFFOLD or
audit note rather than a goal. Refusal is the point: a task created with an empty acceptance list
passes `.bytedesk/task-management/bin/tm done` unchallenged, so a silent import would have the gate certify a goal nobody
verified. The refusal names the file and every header it looked for.

Two failure modes matter here and they are not symmetrical. Zero criteria is **refused**. A
*truncated* or *inflated* list is worse, because both look like a successful import and the gate
then closes on the wrong thing — so a fence inside a criterion cannot end the list, and a nested
sub-bullet folds into its parent rather than becoming a peer a gate could satisfy on its own.

### A whole program at once

`.bytedesk/task-management/bin/tm goal import <manifest.plan.json>` takes a `bytedesk-goals` manifest and lands the program:

```
$ .bytedesk/task-management/bin/tm goal import docs/goals/agent-capability-enhancements.plan.json
EP-003 Agent Capability Enhancements — Collaboration, Self-Learning & Memory…
   20 task(s) from 20 goal(s), 14 dependency edge(s)
   20 carry declared touches — `.bytedesk/task-management/bin/tm parallel` batches on those
   integration gate: scripts/testing/local-test.sh pr-ready
   `.bytedesk/task-management/bin/tm next` and `.bytedesk/task-management/bin/tm parallel` now answer for this program
```

Two manifest fields land somewhere that already existed and was starving. `dependsOn` becomes a
task-management dependency — it is a *land* dependency in `run-goals` (a merged PR), which is the same shape as
the board's "blocker resolved" — so `.bytedesk/task-management/bin/tm next` and `.bytedesk/task-management/bin/tm why` answer correctly on an imported program with no
further input. And **`touches` becomes `touches`**, the field `.bytedesk/task-management/bin/tm parallel` batches on: nothing wrote
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
.bytedesk/task-management/bin/tm parallel [--epic EP-1]            batches of unblocked, unclaimed, non-colliding tasks
.bytedesk/task-management/bin/tm worktree new <id> [--base ref]    isolated checkout + branch, heavy artifacts shared
.bytedesk/task-management/bin/tm worktree list | rm <id> | share <id>
.bytedesk/task-management/bin/tm claim <id> [--steal] | release <id> | sweep
.bytedesk/task-management/bin/tm start <id> [--steal]              refuses a task another live session holds
.bytedesk/task-management/bin/tm handoff <id> --worktree           brief that provisions its own checkout
```

Every write to an entity is serialized through one lock in the shared store, so two sessions
writing at the same instant cannot lose each other's changes — which is not a theoretical
concern here, since running several at once is the point. `create` mints an id and writes it
atomically (otherwise two sessions pick the same number and one file becomes unreachable), and
read-append-write edits — comments, labels, links, criteria, evidence, deps — go through
`mutate` so both appends survive.

A task's `touches: []` is what `.bytedesk/task-management/bin/tm parallel` uses to decide which work can run at the same
time — and it is **filled in by watching, not by asking**. A `PostToolUse` hook on
`Edit`/`Write`/`MultiEdit`/`NotebookEdit` records the file that was just edited against the task
the session is holding, so after one pass of real work the store knows what collides with what.
`.bytedesk/task-management/bin/tm touches <id> [path...]` reads it, or declares paths ahead of time.

It attributes to a task it is **sure** about, or to nothing at all: the branch (`tm/TM-014-…`)
first, then the single task in progress, then the claim this session holds. Two tasks running in
one session is genuinely ambiguous and the edit is dropped — a path recorded against the wrong
task is worse than a missing one, because it invents a collision that serializes work *and*
hides the real collision on the task that owns the file. Paths are relative to the checkout
(so the same file in two worktrees is the same path), the store's own files are ignored, failed
edits say nothing, and the list is capped at 40. `.bytedesk/task-management/bin/tm config trackTouches false` turns it off.

> Before this, nothing wrote the field. So `touches` was empty everywhere, every task looked
> disjoint from every other, and `.bytedesk/task-management/bin/tm parallel` would put two tasks that rewrite the same file in
> one batch and tell you to run them side by side — the exact collision it exists to prevent. Claims carry session, worktree and branch, and expire — a session
that never comes back cannot lock a task out of the board forever.

### Sharing heavy artifacts between worktrees

A new worktree gets `node_modules` **symlinked** and `.env` **copied** by default, so it is usable
immediately and costs kilobytes instead of a reinstall. Configure with `worktreeShare`:
`[{path, mode}]` where mode is `symlink`, `copy` or `hardlink`; `**/node_modules` matches every
package in a monorepo. Tracked paths are never shared (a symlink over a tracked file would get
committed), nothing already in the worktree is clobbered, and `.bytedesk/task-management/bin/tm worktree rm` unlinks the shares
before removing — your main checkout's `node_modules` is never at risk.

**The tradeoff:** a symlinked `node_modules` is shared mutable state — `pnpm install` in one
worktree changes them all. Right default for parallel agents reading one dependency tree, wrong
one for a task that changes dependencies. Use `mode: copy` or `--no-share` there.

## Running under Codex CLI and Grok

The store, the CLI and the MCP server are harness-agnostic; the parts that hook into a session are
not, and the difference is worth knowing before you rely on it. Everything below was checked
against the installed CLIs — `codex-cli 0.146.0`, `grok 0.2.117` — not inferred from docs.

| | Claude Code | Codex CLI | Grok |
|---|---|---|---|
| `.bytedesk/task-management/bin/tm` CLI, store, gates | ✅ | ✅ | ✅ |
| MCP server (`bin/tm-mcp`) | ✅ `.mcp.json` | ✅ `codex mcp add` / `.codex-mcp.json` | ✅ `grok mcp add` |
| Session identity | ✅ `CLAUDE_CODE_SESSION_ID` | ✅ `CODEX_THREAD_ID` | ✅ `GROK_SESSION_ID` |
| Native task mirroring | ✅ `TaskCreate`/`TaskUpdate` | ✅ `update_plan` | ✅ `todo_write` |
| Lifecycle hooks | ✅ `hooks/hooks.json` | ✅ `.codex/hooks.json` — see below | ❌ no hook surface |
| Dashboard work stream | ✅ | ✅ reads `~/.codex/sessions/**/rollout-*.jsonl` | ✅ reads `~/.grok/sessions/<cwd>/<id>/chat_history.jsonl` |

What ❌ costs you: without hooks, Grok gets no session-start briefing, no Stop gate and no
automatic commit linking. The board still works — you drive it with `.bytedesk/task-management/bin/tm` and the MCP tools, and
claims still hold, because those read the session variable rather than a hook.

One difference worth knowing about Codex, because it decides whether claims work at all: **Codex
passes a hook no environment variables**. Its session arrives as `session_id` on the payload
instead, so the hook adopts it (`TM_SESSION_ID`) before anything reads it — otherwise every claim,
gate and event under Codex would attribute to nobody. The payload is otherwise Claude-Code-shaped;
a verbatim capture lives in `tests/fixtures/codex-pre-tool-use.json` and the suite drives it.

Registering the MCP server:

```bash
codex mcp add task-management -- <plugin>/bin/tm-mcp
grok  mcp add task-management -- <plugin>/bin/tm-mcp
```

Codex has no plugin-root substitution in `.codex/hooks.json`, so its checked-in hook configuration
uses the project-relative launcher created during bootstrap:

```bash
grep -v '^//' <plugin>/hooks/codex-hooks.example.json > .codex/hooks.json
```

Verified by running it: a `codex exec` turn fires `PreToolUse` and `Stop`, and an `update_plan`
lands on the board as a task attributed to the Codex session.

A harness this plugin does not recognise is reported rather than guessed at: the work stream says
"no agent CLI is running this board" instead of rendering an empty panel forever.

## MCP

`.mcp.json` registers a stdio server (`bin/tm-mcp`) so Claude queries the store as typed tools
rather than parsing CLI text — `tm_board`, `tm_next`, `tm_show`, `tm_find`, `tm_why`, `tm_task_create`,
`tm_task_update`, `tm_ac_add`, `tm_evidence`, `tm_handoff`, `tm_claim` and friends. The gates apply
identically over MCP: `tm_task_create` with no active epic returns the same denial the CLI gives.

Every verb the board or the CLI has, an MCP-only session has too — that is the store's contract,
and for a while it was not true (CAP-0001). The parity tools call the function the dashboard route
calls, with its refusal wording: `tm_worktree` (new / rm / list — provisioning claims first, so a
task another live session holds is refused with nothing on disk), `tm_link` (both ends written,
both ends cleaned on remove), `tm_task_field` (assignee, priority, estimate, type, rank, parent,
dep, comment, touches — one field set per call), `tm_graph` ({nodes, edges} plus the Mermaid),
`tm_doctor` (fix needs `confirm: true`, since it rewrites files), `tm_export` (md / csv / json,
clamped at 64k characters), `tm_time`, `tm_parallel`, `tm_history`, `tm_stale` and
`tm_goal_import` (a path confined to the repository, or the doc's content). `tm_task_update` also
takes `delete` (soft; the file stays) and `restore`.

## Jira-shaped fields

Tasks carry the fields you'd expect from an issue tracker, all optional and all in
frontmatter — a task with none of them set behaves exactly as it did before they existed:

```
.bytedesk/task-management/bin/tm ac <id> "<criterion>" | ac <id> --rm <n>  add or remove one
.bytedesk/task-management/bin/tm accept <id> <n> [--undo]                  tick, or put a mis-tick back
.bytedesk/task-management/bin/tm edit <id> "<title>" [--body <text|->]      correct what `new` got wrong
.bytedesk/task-management/bin/tm move <id> <EP-nnn|none>                   refile under another epic
.bytedesk/task-management/bin/tm assign <id> <who>              .bytedesk/task-management/bin/tm label <id> ui -stale     (a leading - removes)
.bytedesk/task-management/bin/tm priority <id> highest|high|medium|low|lowest
.bytedesk/task-management/bin/tm type <id> bug|story|task|spike|chore   issue type; `parent` expresses subtask-ness
.bytedesk/task-management/bin/tm estimate <id> <points>         .bytedesk/task-management/bin/tm comment <id> "<text>"
.bytedesk/task-management/bin/tm subtask <id> <parent|none>     .bytedesk/task-management/bin/tm link <id> "blocks" <id>  (writes both ends)
.bytedesk/task-management/bin/tm rank <id> --before|--after <id>            .bytedesk/task-management/bin/tm backlog
```

Links are mirrored automatically — `A blocks B` gives B `blocked by A`, because a one-sided
link is invisible from the end you're usually looking at. Dependencies work the same way and are
removable with a leading `-`, the same convention `.bytedesk/task-management/bin/tm label` uses. A dependency that would close a
**cycle is refused** at the point of writing rather than reported afterwards — `.bytedesk/task-management/bin/tm doctor` finds
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

The parent holds the claim, so do not run `.bytedesk/task-management/bin/tm start`, `.bytedesk/task-management/bin/tm done`, `.bytedesk/task-management/bin/tm park` or `.bytedesk/task-management/bin/tm block` on these —
report what you found and let the parent record the outcome. Reads (`.bytedesk/task-management/bin/tm show`, `.bytedesk/task-management/bin/tm board`, `.bytedesk/task-management/bin/tm find`)
and additive notes (`.bytedesk/task-management/bin/tm comment`, `.bytedesk/task-management/bin/tm evidence`) are fine.
```

**Only the unticked criteria**, because a met one is settled and the agent's job is what is left.
**Nothing at all when the parent holds nothing** — a brief injected into every fan-out regardless is
a tax every agent pays for the case where it happens to matter. **Bounded** at 3 tasks, 5 criteria
each and 1200 characters, and it says how many claims it left out rather than truncating silently.

It is deliberately not `handoff()`. That is a cold-start dossier for someone picking a task up with
nothing in hand, and it ends with `Resume with: .bytedesk/task-management/bin/tm start <id>` — exactly wrong advice here, since
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

The parent holds the claim, so do not run `.bytedesk/task-management/bin/tm start`, `.bytedesk/task-management/bin/tm done`, `.bytedesk/task-management/bin/tm park` or `.bytedesk/task-management/bin/tm block` on these —
report what you found and let the parent record the outcome. Reads (`.bytedesk/task-management/bin/tm show`, `.bytedesk/task-management/bin/tm board`, `.bytedesk/task-management/bin/tm find`)
and additive notes (`.bytedesk/task-management/bin/tm comment`, `.bytedesk/task-management/bin/tm evidence`) are fine.
```

**Not the handoff dossier.** `.bytedesk/task-management/bin/tm handoff` is for picking a task up cold — epic body, evidence,
commits, branch, worktree — and it ends with `Resume with: .bytedesk/task-management/bin/tm start <id>`, which is exactly wrong
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

`.bytedesk/task-management/bin/tm standup [iso]` (default: the last 24h) answers the three questions a standup answers — what got
finished, what is being worked on, what is stuck — with the **status path** per item and the stop
reason on anything blocked or parked. Work that moved no status is listed last, summarised by what
did happen to it, because a day of comments and commits is real work.

It shares its collapsing with `.bytedesk/task-management/bin/tm log`, the dashboard's `/activity` screen and `/standup`: a status-changing
write reads as `→ blocked`, and a generic `update` that a specific event in the same second already
explains is dropped. The screen gets the sentence for each event kind from the store's own catalog
over `/api/meta`, so all three surfaces describe the same event the same way.

## Settings

Board preferences live in the repo's own `config.json`, next to the tasks, so they follow the
project rather than the browser — open the same board on another machine and your notification
categories, your name and your layout are already set.

`/settings` renders the **settings catalog** (`GET /api/settings`) group by group — dashboard,
policy, workflow, ntfy — with a **dirty state**: edits collect in a draft, **Save** writes them in one
`POST /api/settings`, **Reset** drops them, and a refusal from the server is pinned to the field it
names. Identity (`boardId`, `owner`) is shown read-only, because git derives it. Writable keys are an
allowlist (`lib/settings.mjs`); the gates — `enforce`, `wipLimit`, `requireAcceptance` — are in that
catalog now, so the board and `.bytedesk/task-management/bin/tm config` write the same keys the same way.

The same page carries what used to need a terminal: **templates** (list, edit, create — the
starters `.bytedesk/task-management/bin/tm task new --template` reads), **ntfy** per-kind toggles (the list
`.bytedesk/task-management/bin/tm ntfy on <kind>` writes, as `ntfy.categories`) with a **Test send** whose result — `sent` or the
reason `shouldPublish` declined — is shown verbatim, the one-shot **override** (`.bytedesk/task-management/bin/tm override`) with
its reason, a theme selector (auto / dark / light), and the browser's own notification permission,
which is a browser grant and cannot be stored for you, so the page asks for it rather than
pretending.

`localStorage` is kept as a cache so the board renders instantly and still works offline; the repo's
copy wins as soon as it arrives.

## The task inspector

A card opens at `/tasks/<id>` as an **inspector** — a panel over the list you came from, so the
URL is shareable, the back button closes it, and a deep link into an empty tab renders the board
underneath. The panel is a grid: a header row that stays put and a body that scrolls
(`overscroll-behavior: contain`, so a wheel that reaches the end does not move the board). On a
phone it is the whole screen, with tabs.

The header carries the identity: id, status, who holds the claim, the epic, the decision role, and
the title as an inline edit. The body is grouped into sections, each backed by the route the CLI
verb uses: context (markdown), the **Answer** field a `decision:*` ticket must fill before `done`,
the workflow verbs (start, done, park/block with an inline reason field, reopen — refusals shown in
the CLI's own words), type/priority/epic/sprint/parent, people and size, labels from the catalog,
acceptance criteria (tick, untick, remove, add), blocked-by with the **why** chain
(`GET /api/task/:id/why` — every hop and its reason, down to the root), links, the worktree (create,
remove with `force`), evidence (inline preview, paste-as-log, upload, detach), touches, comments
(append-only, like `.bytedesk/task-management/bin/tm comment`), and a **History** tab that is `.bytedesk/task-management/bin/tm log <id>` for this entity.
A task in progress shows its **work stream** — the harness transcript, live — beside the fields.
The actions menu copies the handoff brief, claims, releases, steals, soft-deletes (with confirm)
and restores.

Epics, sprints, decisions and capabilities open the same way at `/epics/<id>`, `/sprints/<id>`,
`/decisions/<id>` and `/capabilities/<id>`.

`tests/browser/drawer.mjs` measures the layout in a real browser at a short viewport — that the
header stays, the body scrolls, and nothing overflows. It is not part of `run-tests.sh` (it needs
Chrome and a served build); see [Working on the dashboard](#working-on-the-dashboard).

## Acceptance criteria are not a one-way door

`.bytedesk/task-management/bin/tm done` is gated on the list, so a stray tick or a typo'd criterion changes what the tool will
accept. Ticking existed on all three surfaces and unticking on none — the dashboard's checkbox even
set `isDisabled` once checked, locking the box it had just ticked — and nothing anywhere could remove
a criterion. The only way back was editing the frontmatter by hand.

```
.bytedesk/task-management/bin/tm accept <id> <n>            tick
.bytedesk/task-management/bin/tm accept <id> <n> --undo     put a mis-tick back
.bytedesk/task-management/bin/tm ac <id> --rm <n>           remove one that should never have been there
```

The board's checkbox toggles, and each criterion has a ✕. Over MCP it is one tool: `tm_ac_accept`
with `undo` or `remove`.

Unticking **does not reopen a task that is already done**. That is a decision, not an invariant — the
work may genuinely be finished and the criterion simply mis-ticked — and `.bytedesk/task-management/bin/tm doctor` already reports
that state as `done-unmet` and declines to auto-repair it for the same reason. The CLI says so when
it happens rather than acting on your behalf.

Removing **renumbers what follows**, so every surface returns the surviving list: "AC 4" in an older
commit message now points at a different sentence.

## Why a card stopped

`.bytedesk/task-management/bin/tm park <id> <why>` and `.bytedesk/task-management/bin/tm block <id> <why>` store the sentence you type, and both boards show it
— on the CLI line right after the title, and on the dashboard card as its own line of prose. `.bytedesk/task-management/bin/tm
show` prints it unabridged; the board clamps it and ends in `…`, because a board is for scanning and
`.bytedesk/task-management/bin/tm show`/`.bytedesk/task-management/bin/tm why` are where the whole thing lives.

It is shown only while it applies: `.bytedesk/task-management/bin/tm start` on a parked task does not clear `parkedReason`, and a
task that is being worked on is not waiting on anything.

## Sprints

```
.bytedesk/task-management/bin/tm sprint new "Sprint 12" [--ends 2026-08-14]     create and make it active
.bytedesk/task-management/bin/tm sprint add <id>...  |  rm <id>...              commit work to it, or take it back
.bytedesk/task-management/bin/tm sprint [show|list|use <id>|done]
```

A sprint is its own kind — `sprints/SP-001-….md`, an id, a body — because everything one needs the
store already does for epics and ADRs. It is **not** a second epic: an epic says what a body of work
*is*, a sprint says what you committed to finishing this fortnight, and a task has one of each.

`.bytedesk/task-management/bin/tm sprint` is the report `estimate` never had a reader for. Points were writable from the CLI, the
dashboard and MCP and consumed by nothing — `burndown` counts cards, so a two-point card and a
thirteen-point card move the line equally. A sprint gives them a denominator:

```
3/16 points done across 4 card(s), 1 unsized
```

Cards with no estimate are counted **apart**, not as zero: "12 of 20 done, and four nobody sized" is
true, where folding the unsized into zero would report the sprint as further along than it is.

Closing a sprint does not touch unfinished work — it is simply no longer committed, and says how
much is left. `.bytedesk/task-management/bin/tm find sprint:SP-001` lists it.

## Searching

Bare words are a case-insensitive substring over titles and bodies. `field:value` narrows, and a
leading `-` negates:

```
.bytedesk/task-management/bin/tm find status:in_progress priority:highest
.bytedesk/task-management/bin/tm find assignee:ryan -label:stale
.bytedesk/task-management/bin/tm find epic:EP-002 type:bug "the half-remembered title"
.bytedesk/task-management/bin/tm find -assignee:                     # the unassigned queue
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

The board speaks the same syntax: `/search`, the board's query bar and every `?q=` in a URL parse it
the same way, and `/api/find` answers with `lib/query.mjs` — so a query that works in the terminal
works on the board. The browser reads the field list from `GET /api/meta` (`vocab.findFields`) and
keeps a static fallback in `dashboard/src/lib/filters.ts`; a test reads that file and holds it to
`FIELDS`, so the two cannot drift.

`edit` and `move` exist because every *other* field had a verb and the two you type first did not.
A retitle **keeps the file name** — `TM-001-typoed-titel.md` gains the corrected title inside —
because the id is the identity and the slug is decoration: a rename is a delete-plus-add in git
that breaks blame on the entity's whole history, and the old path may already sit in a commit
message or an evidence ref. Re-submitting a value that is already stored writes nothing, so an
`updated` stamp still means the task actually moved.

`move` is not just a field write, because both epics' lifecycles depend on their children. Into a
`done` epic, an unfinished task **reopens** it — a finished epic holding live work is the lie
`.bytedesk/task-management/bin/tm reopen` already refuses to leave behind, and the auto-close will never re-close it on its own.
Out of an epic, the source gets the same **auto-close** check that finishing a task there would
give it; an epic emptied entirely stays open, because zero tasks is not an achievement.

All three surfaces do both now — `.bytedesk/task-management/bin/tm edit`/`.bytedesk/task-management/bin/tm move`, `tm_task_edit`, and `PATCH /api/task/:id`,
which previously took title and body only. That last gap meant the board could file a task under
the active epic and never move it out again.

**`.bytedesk/task-management/bin/tm next` is ordered by them.** An explicit `rank` first, in rank order — a rank is only ever
set by deliberately placing that task relative to another, which is a stronger statement than a
label, and it is Jira's rule too. Everything unranked follows by `priority`, with an unset
priority read as `medium`. Id breaks the remaining ties, so the order is total and the same board
never renders two ways. The rendered line shows `!<priority>` when one is set, because a list
whose order has no visible reason is a list you cannot trust.

This is the order every caller of `next` gets: the `.bytedesk/task-management/bin/tm next` verb, the SessionStart context
block, the `tm_next` MCP tool, the `@`-mentionable resource list, and `.bytedesk/task-management/bin/tm parallel`. The sort is
inside `nextTasks`, not at those five call sites — an order each caller has to remember to apply
is an order some caller will not have.

## Dashboard write surface

The board is not read-only. Every write goes through the same `lib/` functions the CLI calls,
so the gates, the event log and the markdown files stay authoritative no matter which surface
made the change — a transition to `done` from the dashboard runs the same acceptance gate, takes
the same claim, fires the same dependency unblock and closes the epic the same way. Starting a
task runs the same WIP check (`gateStart`) the CLI and MCP run.

The shape, in one line per family; the full table with bodies, responses and the lib function
each route delegates to is [`docs/dashboard-api.md`](docs/dashboard-api.md):

| Route | Does |
|---|---|
| `POST /api/task` · `PATCH /api/task/:id` · `POST /api/task/:id/transition` | create (active-epic gate), edit title/body/epic, status change with claim + gate + unblock + epic auto-close |
| `POST /api/task/:id/{assign,labels,type,priority,estimate,comment,link,unlink,subtask,dep,rank,ac,accept,evidence,sprint,worktree,touches}` | field writes — every `.bytedesk/task-management/bin/tm` verb |
| `POST /api/task/:id/{claim,release,delete,restore}` | the claim interlock and soft delete |
| `POST /api/bulk` | one op across many ids, partial success reported per id |
| `POST /api/epic` · `PATCH /api/epic/:id` · `POST /api/epic/:id/{close,reopen,plan}` | activate/create, edit, lifecycle, plan link |
| `POST /api/adr` · `PATCH /api/adr/:id` · `POST /api/adr/:id/{accept,supersede}` | decisions |
| `POST /api/sprint` · `PATCH /api/sprint/:id` · `POST /api/sprint/:id/done` | sprints |
| `POST /api/capability` · `PATCH /api/capability/:id` · `POST /api/capability/:id/{accept,ship,drop}` | the enhancement backlog |
| `POST /api/goal/import` | `.bytedesk/task-management/bin/tm goal import` — a doc or a manifest, path confined to the repo |
| `POST /api/doctor/fix` · `POST /api/claims/sweep` | need `{confirm:true}` — both touch other sessions' state |
| `POST /api/override` · `POST /api/ntfy/test` · `POST /api/reindex` · `POST /api/settings` · `POST /api/templates` · `PATCH /api/templates/:name` | gates, notifications, cache, config, templates |
| `GET /api/meta` | the store's vocabulary (columns, priorities, types, link types, event catalog, search fields), so the SPA hardcodes none of it |
| `GET /api/task/:id/{why,handoff,time,history}` · `/api/{graph,standup,time,stale,find,claims,parallel,sessions,doctor,skills,export}` | the reads that used to be CLI-only |

Refusals carry the CLI's own wording: a gate says no with **409** and the reason, bad input is
**400**, a missing task is **404**. The UI shows that text at the control and in a toast rather
than a generic failure. `GET /api/export?format=csv&download=1` is the one route that returns a
file; nothing serves paths outside `evidence/` and `plans/`.

## Skills

`/task-management:epic` · `board` · `adr` · `handoff` · `standup` · `groom` · `override` · `enhance`

## Capabilities — what to build next

Tasks answer "what am I doing"; capabilities answer "what is worth doing". A capability
(`CAP-*`) is a proposal: a problem, sized by impact × ease × confidence, with acceptance
criteria, before anyone commits to building it.

```
.bytedesk/task-management/bin/tm cap new "Jump palette cheatsheet" --area ux --impact H --effort S --confidence H
.bytedesk/task-management/bin/tm cap list                       # ranked; score 1–27, high is do-this-first
.bytedesk/task-management/bin/tm cap accept CAP-0001            # → TM-014, criteria carried over as its gate
.bytedesk/task-management/bin/tm evidence CAP-0001 test/palette_test.go
.bytedesk/task-management/bin/tm cap ship CAP-0001              # refuses without evidence
```

Accepting is the seam between the two layers: the task carries the card that justifies it, so
the reason for the work outlives the session that proposed it. `/enhance` drives the whole loop
— capture product state, research, propose ranked cards, track to shipped.

Impact and confidence are H/M/L, effort is S/M/L. Both vocabularies are what people already
write on a card, so `impact: L` means *low*, not *large*.

Migrating from a `docs/capabilities/` store (INDEX.yaml + CAP-*.md)?

```
node scripts/import-capability-cards.mjs --dry-run
```

Ids are preserved, so every reference in a commit message or PR still resolves.

## Dashboard

Starts automatically while the plugin is enabled (a `plugin-active` monitor). Port in
`.bytedesk/task-management/dashboard.port` — assigned once, probed free above 45000 and then
kept, so the project opens at the same URL every time (`TM_DASHBOARD_PORT` pins one). Run it by
hand with `.bytedesk/task-management/bin/tm-dashboard` (`--status`, `--restart`).

It is a multi-screen app, one route per thing the plugin can do, so everything the CLI and MCP
expose has a place on the board:

| Route | Shows |
|---|---|
| `/board` | six status columns, or one row of columns per epic; filters in the URL in `.bytedesk/task-management/bin/tm find` syntax; saved views; drag and keyboard |
| `/backlog` | the ranked queue `.bytedesk/task-management/bin/tm next` reads, rank by drag or `[`/`]`, sprint commit, points |
| `/epics`, `/epics/:id` | progress, plan, decision-map sections, children, ADRs, make active / close / reopen, **import goals** |
| `/tasks/:id` | the inspector above |
| `/graph` | the dependency graph `.bytedesk/task-management/bin/tm graph` draws, with the **why** chain for the focused node and Mermaid to copy |
| `/activity` | the event log with kind/actor/session filters, live |
| `/standup` | `.bytedesk/task-management/bin/tm standup` since a time you pick, copy as markdown |
| `/sprints`, `/sprints/:id` | points burndown, commit and uncommit, close |
| `/capabilities`, `/capabilities/:id` | the ranked enhancement backlog: propose, accept, ship with evidence, drop with a reason |
| `/decisions`, `/decisions/:id` | ADRs: create, accept, supersede, edit |
| `/plans` | the plans inbox, preview, link to an epic, **import a goal doc or manifest** |
| `/sessions` | who holds what: claims with session, worktree, branch and expiry; WIP against `wipLimit`; worktrees; **parallel batches**; subagents; sweep |
| `/doctor` | `.bytedesk/task-management/bin/tm doctor` findings, fix the unambiguous half behind a confirm, reindex |
| `/search` | `.bytedesk/task-management/bin/tm find` — `field:value`, `-` negates, unknown fields refused with the list that exists |
| `/reports` | cycle time, throughput, time in status, stale work, and **export** md/csv/json |
| `/settings`, `/help` | the catalog above; shortcuts, the skills catalog with copyable `/task-management:*` commands, the CLI cheatsheet |

It is built on the **ByteDesk design system**: the family tokens are vendored at
`.context/design-system/` by `bd-design sync`, the app consumes them through `--tm-*` roles in
`dashboard/src/styles/tokens.css`, and no colour, radius, spacing or motion literal exists outside
that file (`npm run design:check` greps for one). Dark is the default and light is its equal;
status is always a dot **and** a word; ids, SHAs, paths and timestamps are in Plex Mono, self-hosted
because the board runs offline.

**Live.** One SSE feed (`/events`) carries every write from every session and the CLI. A per-entity
event refetches that one entity; a structural one (create, done, moved, epic lifecycle) refetches
the board; a reconnect replays from `Last-Event-ID`. Field writes are optimistic and roll back with
the server's refusal in a toast; `done`, claims and worktrees are not, because the gate decides.
Offline, writes queue in an outbox and replay when the network returns; the app installs as a PWA
and shows notifications while backgrounded.

## Getting the board out

```
.bytedesk/task-management/bin/tm export                            markdown report → stdout
.bytedesk/task-management/bin/tm export csv --out board.csv        spreadsheet, or a Jira CSV import
.bytedesk/task-management/bin/tm export json --events              the whole store as one document
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
session dies holding a claim. `.bytedesk/task-management/bin/tm reindex` does not help — it rebuilds the cache **from**
the files, so it faithfully reproduces whatever is wrong with them.

```
$ .bytedesk/task-management/bin/tm doctor
## errors (2)
✗ TM-003    dangling-dep    blockedBy names TM-404, which does not exist  [fixable]
✗ TM-003    orphan-epic     epic EP-077 does not exist  [fixable]

## warnings (3)
! TM-001    one-sided-dep   TM-001 is blocked by TM-002, but TM-002 does not list it in blocks  [fixable]
! TM-001    one-sided-link  TM-001 "duplicates" TM-003, but TM-003 has no "duplicated by" back  [fixable]
! TM-001    missing-evidence  evidence/TM-001-proof.log is recorded but the file is gone  [fixable]

5 of 5 can be repaired automatically — `.bytedesk/task-management/bin/tm doctor --fix`
```

**error** means the store is lying — a read gives a wrong answer. **warning** means it is
untidy but correct. It **exits 1 on any error**, so it can gate a commit hook or a CI step.

`duplicate-id` is the one it will not repair. Two files claiming one id means only the first
is reachable at all, and deciding which keeps the id changes an identity that commits, links
and dependencies already point at — a judgement, not a typo. (Stores written before writes
were serialized may contain these; that is why it reports rather than guesses.)

`missing-evidence` only looks at refs it can resolve on disk. `.bytedesk/task-management/bin/tm evidence` copies the file
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

Epics are first-class. The active epic — the one every `.bytedesk/task-management/bin/tm task new` files under — is set from the
board's toolbar (`POST /api/epic { id }`, same validation and same event as `.bytedesk/task-management/bin/tm epic use`; a
closed epic is refused rather than silently gating every later create). **New epic** opens one and
sets it active. `/epics` lists them active first, then open, then closed, with progress and the plan
chip; `/epics/:id` is the inspector — body, children with their role and attention chips, ADRs under
the epic, the plan, make active, close (with a confirm), reopen, and **Import goals…**, which is
`.bytedesk/task-management/bin/tm goal import` scoped to this epic.

**Group by epic** turns the six status columns into one row of columns per epic, with a progress
bar and `done/total` per lane. The active epic sorts first, then open epics by id, then closed ones,
then unfiled work — which is never dropped, because a task with no epic is exactly the thing you
want to notice. An epic id with no epic file gets a lane marked `missing` rather than hiding the
tasks behind the data fault (`.bytedesk/task-management/bin/tm doctor --fix` clears it).

The keyboard cursor reads the same six columns whether or not the board is grouped: grouping sorts
tasks lane-first, so `j` keeps walking down the screen instead of hopping between lanes.

## The board without a mouse

`?` opens the shortcut sheet on any screen. The short version, on the board and the backlog: `j`/`k`
walk a column, `h`/`l` cross columns (skipping empty ones), `g`/`G` jump to the ends, **`1`–`6`
move the focused card to that column** — the number is printed in each column heading, because the
heading is the shortcut — `[`/`]` reorder, `x` selects for the bulk bar, `w` watches, `o`/`Enter`
opens, `c` creates, `/` focuses the query bar. The map lives in `dashboard/src/lib/keys.mjs` as
data, and the sheet is rendered from it, so the two cannot drift.

`⌘K` / `Ctrl-K` opens a command palette over every screen, every board action and every visible
entity, so "set this to blocked" is something you can type rather than somewhere you have to find.
It opens from inside a text field too.

Shortcuts go quiet while you are typing in a field or a dialog is up, and any modifier chord that
isn't `⌘K` is left to the browser — swallowing `⌘R` would be worse than having no shortcuts at all.
Cards are real focusable list items with `aria-label`s carrying what the chips show, on a roving
tabindex, so `Tab` and `j`/`k` agree on where the cursor is. An inspector moves focus to its heading
when it opens and back to the card when it closes; nothing on the board asks a question through
`window.prompt`.

## Working on the dashboard

The board `.bytedesk/task-management/bin/tm-dashboard` serves is the built bundle in
`dashboard/dist/` (committed, so the plugin works on a clone with no `npm install`). Editing
`dashboard/src/` therefore changes nothing until you rebuild — which is a slow way to move a card
two pixels.

For live editing, run the Vite dev server **alongside** the normal board:

```bash
.bytedesk/task-management/bin/tm-dashboard & # the API, the SSE feed and the store
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

The tokens come from `.context/design-system/tokens/css/bytedesk.css`, vendored by the
`design-system` plugin (`bd-design sync`; `node .bytedesk/design-system-check.mjs` says whether
the vendored copy matches the plugin). Components consume the `--tm-*` roles in
`dashboard/src/styles/tokens.css` and never a foundation value, and `npm run design:check` fails
on any colour literal under `src/`.

When you are done, rebuild so the served bundle matches the source, restart the board, and run
the browser checks against it:

```bash
npm --prefix dashboard run build         # tsc --noEmit && vite build && the PWA assets
npm --prefix dashboard run design:check  # no colour literal outside tokens.css
bin/tm-dashboard --restart --no-browser
TM_ROOT=<repo> node tests/browser/keyboard.mjs   # the keyboard, over CDP
TM_ROOT=<repo> node tests/browser/drawer.mjs     # the inspector's layout at a short viewport
TM_ROOT=<repo> node tests/browser/routes.mjs     # every route at 1440 and 390: no console error, no sideways scroll, an h1
```

`dashboard/src/lib/*.mjs` (`keys.mjs`, `lanes.mjs`, `liveness.mjs`, `markdown.mjs`),
`dashboard/metrics.mjs` and `dashboard/src/pwa/*.mjs` are plain JavaScript on purpose: they hold
the logic, and `node --test` can reach them without a TypeScript runner. Screens under
`dashboard/src/features/<screen>/` stay thin over `src/lib/store.ts` (the SSE-fed entity store),
`src/lib/router.ts` and the primitives in `src/components/ui/`; the contract they were built
against is [`docs/dashboard-contract.md`](docs/dashboard-contract.md).

## Config

`.bytedesk/task-management/bin/tm config` prints the current policy; `.bytedesk/task-management/bin/tm config <key> <json>` sets one.

| Key | Default | Effect |
|---|---|---|
| `enforce` | `true` | master switch for every gate |
| `requireEpic` | `true` | `TaskCreate` needs an active epic |
| `requireAcceptance` | `true` | `.bytedesk/task-management/bin/tm done` needs all criteria ticked |
| `wipLimit` | `3` | max concurrent `in_progress` |
| `staleMinutes` | `90` | when `in_progress` starts being called stale |
| `gitLink` | `true` | attach commits/PRs automatically |
| `captureDecisions` | `"smart"` | `"smart"` records real decisions only; `true` records every question; `false` none |
| `autoCloseEpics` | `true` | close an epic when its last child is done |
| `trackTouches` | `true` | record edited files on the claimed task (what `.bytedesk/task-management/bin/tm parallel` batches on) |
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

Three checks are deliberately **outside** that suite, because they need Chrome and a served build:

```bash
npm --prefix dashboard run build && bin/tm-dashboard --restart --no-browser
TM_ROOT=<repo> node tests/browser/keyboard.mjs   # real key events, real browser, over CDP
TM_ROOT=<repo> node tests/browser/drawer.mjs     # the inspector's header stays, its body scrolls
TM_ROOT=<repo> node tests/browser/routes.mjs     # every route, desktop and phone
```

`keyboard.mjs` drives the board's keyboard and asserts the DOM — that focus follows the cursor,
that the ring is visible, and that typing `j` in the query bar types a `j`. `routes.mjs` opens
every route in `dashboard/src/app/routes.ts` at 1440 and 390 and fails on a console error, a
sideways scroll or a missing `h1` — the quiet failure a lazy chunk can have. All three skip cleanly
when there is no Chrome or no board running, so they never fail for being unrunnable, and each
attaches only to the Chrome it launched.

## Notes

- The store is per-workspace, resolved as `TM_ROOT` → git toplevel → `CLAUDE_PROJECT_DIR` → cwd,
  so a worktree keeps its own board.
- Markdown files are the source of truth. `index.json` is disposable.
- Commit `.bytedesk/task-management/` — that's the point. One file per entity keeps merges sane.
- `.bytedesk/task-management/bin/tm init` writes the store's own `.gitignore` and `.gitattributes`, plus
  `.bytedesk/.gitignore` for worktrees (they live next to the store, so a store-local
  rule cannot see them). The markdown, `config.json`, `evidence/` and
  `.bytedesk/task-management/bin/`
  launchers are the shared record and belong in git; `index.json` (a cache),
  `state.json` (session claims), `events.jsonl` (this host's audit log), `dashboard.pid` /
  `dashboard.port` / `dashboard.*`, `port.assigned`, `state.lock*` and `.tm-tmp-*` do not.
  SessionStart after a plugin update tops the contract up
  and `git rm --cached`s any of those files git is still carrying, so an already-tracked
  `events.jsonl` leaves the index on the next session without being deleted from disk.
- `.bytedesk/task-management/bin/tm doctor` reports a store with no contract and writes one, and `--fix` untracks a
  per-machine file that is already in the index, since being ignored does not help once git
  is carrying it.
