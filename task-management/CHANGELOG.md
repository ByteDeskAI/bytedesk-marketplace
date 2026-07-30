# Changelog

## Unreleased

### Removed

- **`tm export pm`.** The format emitted `pm_issue_create` payloads for the
  `project-management` plugin, which has been removed from this marketplace — so it was
  exporting to a destination that no longer exists here. `md`, `csv` and `json` are unchanged,
  and an unknown format is still refused rather than silently substituted. This also retires the
  README's long-standing note delegating sprints to that plugin, which means sprints are now a
  legitimate candidate for this one: `burndown()` still has no denominator and `estimate()`
  still has no consumer.

### Added

- **`tm edit` and `tm move`: nothing could correct a title or refile a task.** Every other field
  on a task had a verb — assign, label, priority, type, estimate, rank, subtask, dep, link — and
  the two you type first, the title and the body, had none. `tm edit TM-001 "..."` answered
  `unknown verb: edit`, and none of the 16 MCP tools touched either field. The correction did
  exist: `PATCH /api/task/:id`, reachable only from the browser.

  The epic was worse — **nothing anywhere could change it**, not the CLI, not MCP, and not that
  PATCH, which took title and body only. Since `tm task new` files into whatever epic is active
  and the create gate *requires* an active epic, filing into the wrong one was one keystroke away
  with no way back short of editing frontmatter by hand.

  ```
  tm edit <id> "<title>" [--body <text|->]      # --body - reads from stdin, like tm evidence
  tm move <id> <EP-nnn|none>
  ```

  A retitle **keeps the file name**: `TM-001-typoed-titel.md` gains the corrected title inside.
  The id is the identity and the slug is decoration — a rename is a delete-plus-add in git that
  breaks blame on the entity's whole history, and the old path may already be recorded in a commit
  message, an evidence ref, or a `tm show --json` a script is holding.

  Re-submitting a value that is already stored writes nothing and says `unchanged`, so an
  `updated` stamp still means the task actually moved. That needed care for the body: the
  round-trip is not identity — `serializeDoc` writes a newline after the closing frontmatter fence
  and `parseDoc` hands it back, so a body written as `"notes"` reads as `"\nnotes"` and a raw
  `!==` reports a change every time. Compared trimmed, and the asymmetry is pinned by a test.

  `move` respects both epics' lifecycles rather than writing a field: into a `done` epic an
  unfinished task **reopens** it, and out of an epic the source gets the same **auto-close** check
  finishing a task there would give it. An epic emptied entirely stays open — zero tasks is not an
  achievement, which `autoCloseEpic` already declined.

  All three surfaces: `tm edit`/`tm move`, the `tm_task_edit` tool, and `PATCH /api/task/:id`,
  which now accepts `epic`. `edit` and `moved` are on the timeline as their own events, so the log
  says "a title is corrected" rather than "a field changed" — and `moved` records where the task
  came *from*, which the destination alone does not tell you.

- **`tm log` renders for a person, and `tm log <id>` is a per-issue changelog.** Its human branch
  was `rows.map((e) => JSON.stringify(e))` — the same output `--json` gives — so the one surface you
  reach for when two agents disagreed about a claim, or a card moved and nobody knows who moved it,
  was raw JSONL. Every other read verb had a renderer.

  The tail groups by day; a single entity's history shows the status path it took with elapsed time
  measured from its first start, which is the question a changelog answers. Two log lines per write
  collapse into one — `prioritise()` calls `update()`, so every semantic write logged twice and the
  fact was buried under its own bookkeeping. The per-event sentences are **not** redefined:
  `CATALOG.events` already carries one for every kind the store emits, and a test derives that list
  from the source, so a new event gets a description in both places or neither.

- **`tm type <id> <bug|story|task|spike|chore>`** — issue type as a stored field with a vocabulary,
  the last Jira system field this store treated as free text. `subtask` is deliberately *not* in
  the vocabulary: `parent` expresses that, and conflating the two is the bug below.

  Existing stores need no migration. `typeOf` reads the stored field first, then falls back to a
  recognised type worn as a **label** — which is how the bug/spike/chore templates encoded it
  before the field existed (`labels: ["bug"]`) — then to `task`. Templates now set the field and
  keep the label, since a label is still a useful filter.

- **`tm goal import <manifest.plan.json>`** — a whole program in one command: one epic, one task
  per goal with criteria parsed from its own doc, the manifest's `dependsOn` as tm dependencies,
  and its declared `touches` on the field `tm parallel` batches on. Measured across the 36
  manifests and 506 goals in `bytedesk-platform`: every goal carries `dependsOn`, `mode`,
  `needsHumanGate` and `touches`; 405 have real dependencies and 498 have real touches. So an
  import makes `tm next`, `tm why` and `tm parallel` correct on a 20-goal program before any work
  starts. A goal whose doc has no parseable criteria is skipped and named — never imported with an
  empty gate — and the exit code is 2 when anything was skipped so a script notices.

- **`tm goal import <doc.md>`** — a goal's own success criteria become the gate that closes it.
  `/goal` is Claude Code's persistent-agent loop and it requires a verifiable stop condition;
  `tm done` refuses until every acceptance criterion is ticked. Same requirement, already written
  down in the goal doc. Reads both the `bytedesk-goals` doc form (`# Goal:` heading + criteria
  list) and the 5-part `/goal` composer contract, where `**Stop when:**` is the criterion and
  `**Validate:**` is kept as the command `tm evidence` stores output from. The Jira key, objective,
  constraints and read-first notes are copied into the task body, because `bytedesk-goals` deletes
  a goal doc once it is done.

  Built against all **195** real goal docs rather than a sample, because there is no single format:
  three header spellings and two item forms, of which **46 documents use numbered items** that a
  dash-only parser drops. 171 parse; the other 24 are **refused** — a task with an empty acceptance
  list passes `tm done` unchallenged, so a silent import would have the gate certify a goal nobody
  verified. The refusal names the file and every header it looked for.

- **`tm reopen <id> [why]`** — the way back from done, recorded rather than improvised.

### Added

- **Dependencies are removable, and the board can change them.** `tm dep <id> -<blocker>` removes,
  using the leading-dash convention `tm label` already has — before this there was no way to remove
  a dependency at all: `doctor` could drop a *dangling* reference, but a valid one added by mistake
  was permanent.

### Fixed

- **`priority` and `rank` were write-only: nothing ever read them.** `nextTasks` filtered and
  returned whatever order `list` gave it, which is id order — creation order. So a task set to
  `highest` and placed at the top of the backlog still came second behind an untouched `low` one:

  ```
  $ tm backlog
    1. ○ TM-002 zzz the urgent one      ← rank #1, priority highest
    2. ○ TM-001 aaa low thing
  $ tm next
  ○ TM-001 aaa low thing                ← the wrong one, and this is the verb agents call
  ○ TM-002 zzz the urgent one
  ```

  `tm next` is what the README, the SessionStart context block and the `tm_next` tool all point
  an agent at, so priority could not influence what any agent picked up — two fields the CLI, the
  dashboard and MCP could all write, and no reader anywhere. It showed up in this project's own
  orientation block, which listed "next unblocked" in id order.

  Ordered now: an explicit `rank` first, then `priority`, then id. Ranked ahead of unranked rather
  than interleaved — a fallback rank derived from list position gives every task a distinct
  pseudo-rank, and priority as a tiebreaker on values that are never tied is priority that still
  does nothing. Id last makes the order total, so the same board cannot render two ways.

  The sort lives inside `nextTasks` rather than at its five call sites (`tm next`, the
  SessionStart block, `tm_next`, the resource picker, `tm parallel`), because an order every
  caller has to remember to apply is an order some caller will not have. `taskLine` shows
  `!<priority>` when one is set, so the ordering has a visible reason.

  `tm backlog` is deliberately untouched: `tm rank --before/--after` computes a new rank from the
  positions backlog reports, so changing that order would change what those flags mean.

  The priority vocabulary moved from `issue.mjs` to `store.mjs` — the queue order reads it and
  store.mjs is what issue.mjs is built on, so the other direction would have been an import
  cycle. `issue.mjs` re-exports it and still owns the field: validation, the event, the verb.

- **`tm doctor --fix` deleted the evidence it could not resolve, including the url of the PR that
  proved the task.** The check asked `existsSync(join(root, ref))` for every evidence ref and
  offered to drop whatever came back false — and `join(root, "https://…/pull/69")` is a path that
  can never exist, so a url was reported as drift and the repair removed it. Same for an absolute
  path (`join(root, "/var/log/build.log")` is `<root>/var/log/build.log`, so a file sitting right
  there read as gone) and for an opaque handle like `browser:019fb067-…`.

  This is not a hypothetical: it was found because this project's own board carried two
  `browser:` refs, they were the only two findings standing between it and a clean bill of health,
  and the obvious next keystroke would have destroyed them.

  Both writers — `tm evidence` and the `tm_evidence` tool — copy the file into the store, so
  everything they record is store-relative and checkable. The third writer is a hand edit, which
  is not abuse: openable markdown is the store's whole premise, and a person recording what proves
  a task reaches for whatever is probative. So a ref with a scheme is now skipped rather than
  reported (nothing here can resolve it, and a finding whose fix destroys data is worse than no
  finding), and an absolute ref is checked where it actually points. An absolute ref that really
  is missing is still reported — resolving it correctly must not mean never checking it — and a
  Windows drive letter is still treated as a path, since RFC 3986 would otherwise let `C:` parse
  as a scheme.

- **A subagent's work was never attributed, in 317 consecutive firings.** The README promises "its
  work is attributed on the timeline, so parallel agents are visible"; this project's own store holds
  317 `subagent_stop` events and **not one** has a task against it. The filter asked whether a
  claim's session equalled `input.session_id || CLAUDE_SESSION_ID`, and the `||` let the payload win
  — but the payload's `session_id` is the **subagent's**, while every claim is held by the **parent**
  (`tm start` runs there). The comparison could only match when the two ids happened to be identical.
  Two different things were being read out of one field.

  Separated: the parent's session selects the claims, since those are the tasks the fan-out is
  working on, and the subagent's own id is recorded as the agent so the timeline says *which* agent
  finished. `transcript_path` is carried too — it is in every hook payload and is the only durable
  pointer back to what the subagent actually did.

- **The CSV Issue Type column was fabricated from parentage.** `toCsv` wrote
  `t.parent ? "Sub-task" : "Task"` — which is *structure*, not type — so a **bug** that happened to
  be a subtask exported as `Sub-task` and its bug-ness was lost, and every top-level bug exported
  as `Task`. The store already knew the answer; it was in the wrong field and the exporter did not
  look.

- **Dependency writes were the one mutation with no `lib/` function.** `issue.mjs` owns assignee,
  labels, priority, estimate, comments, typed links, subtasks and rank — and contained zero
  occurrences of `blockedBy`. Dependencies were two inline `mutate()` calls in `bin/tm`, with three
  consequences: the dashboard rendered `⊘ TM-002` on a card and had **no route to change it**
  (`dashboard-api`'s action switch had `link`/`subtask`/`rank`/`ac` and no `dep`), nothing logged an
  event so a dependency appearing or vanishing was invisible in `tm log <id>`, and removal did not
  exist. Now `dependencies(id, {add, remove})` in `issue.mjs`, used by the CLI, the dashboard and
  the manifest importer alike.

  A cycle is **refused at the point of writing**, matching how `subtasks` refuses a parent loop —
  `doctor` finds cycles and will not repair them because which edge to cut is a judgement. A
  refused edge writes nothing, rather than landing half of itself. Removing the last blocker
  deliberately does **not** reopen the task: `unblockDependents` owns that transition and checks
  every blocker, and two functions deciding one status is how they come to disagree.

- **`tm goal import` mis-read the criteria it gates on, three ways.** The census behind the first
  version counted only the 195 docs at the *top level* of `docs/goals`; there are **555**
  recursively, and manifests reference nested paths directly, so the subdirectories were never an
  edge case. Against the real corpus:

  - a heading that qualifies the phrase rather than leading with it was missed —
    `## Goal (verifiable success criteria)` (8 docs) and `## Remaining work (success criteria)`;
  - **a fence inside a criterion ended the list.** A criterion that embeds the command proving it
    contains a `#` comment, which the section-boundary test read as a heading: one real doc parsed
    to **1 criterion where 6 exist**;
  - **nested sub-bullets became peers.** Indentation was destroyed by trimming before matching, so
    a criterion with five sub-items produced **11 criteria where 6 exist**, each sub-clause
    becoming something a gate could be satisfied by alone.

  The truncation and inflation are worse than a failed parse, and that asymmetry is now stated in
  the module: zero criteria is *refused*, but a wrong-length list **looks like a successful import**
  and the gate closes on the wrong thing. 530 of 555 now parse; the 25 refusals are all READMEs,
  CONTEXT notes, EPIC stubs, JIRA scaffolds and audit docs. A corpus assertion in the unit tests
  checks the census against the documents themselves, since a number in a comment is exactly what
  went stale.

- **The create form collected a markdown body and threw it away.** `CreateModal` held it in React
  state behind a "Context (markdown body)" placeholder, and `write.create`'s payload type had no
  `body` field — so the text a user watched themselves type was dropped on submit. The server had
  accepted and stored it the whole time (`createTask` passes `body || ""` to `create()`); only the
  browser never sent it.

- **A body written by the CLI was unreachable from the board.** `boardPayload` strips `body` from
  every task, which is right for a list — a 20-task board should not ship tens of kilobytes of
  markdown — but there was no detail route, so the drawer showed a task as a title plus badges.
  `GET /api/task/:id` returns the full record, and the drawer fetches it on open and renders it.

- **Reopening a task left four things wrong, and `doctor` called it clean.** `tm start` on a done
  task was the de facto reopen. It left `closed` in the frontmatter, so `tm export csv` reported
  a resolution date in the `Resolved` column on in-progress work — the one column a Jira import
  cannot repair. It left the epic `done` while holding a live child, and `autoCloseEpic` refuses
  an epic that is already done, so nothing would ever re-close it. `autoCloseEpic` also never
  cleared `state.activeEpic`, so finishing the last task left the active epic pointing at a
  closed one and every subsequent `tm task new` filed into it — the exact condition
  `dashboard-api`'s transition refuses by name, naming a verb that did not exist.

  The guard lives in `update()`, the funnel all four writers share (CLI, dashboard transition,
  `tm_task_update`, doctor's own fixes), and is held to exactly two effects: drop `closed`, and
  reopen the parent epic. Kind-aware, so `reopenEpic`'s own update cannot re-enter it, and gated
  on the same `autoCloseEpics` switch — a team that does not want epics closing themselves does
  not want them reopening themselves either.

  `tm doctor` gained **`epic-done-open-children`** (error, fixable) and **`closed-on-open-task`**
  (warning, fixable), because a hand edit or a merge produces the same shapes.

- **Three events were emitted but never classified**, so they were un-notifiable and invisible in
  the ntfy settings panel with nothing to say so: `doctor_fix`, `doctor_release` and
  `override_used`. The test that was supposed to catch this compared against a hand-written list,
  which stopped testing the day someone added a `logEvent`. It now derives the list from the
  source — in both directions, so a stale catalog entry advertising a notification that can never
  fire is caught too. `tm start` refuses a task another live
  session holds; `tm_task_update` with `action: "start"` — the path Claude actually uses — did a
  bare `writeState` and took it silently. Three defects in that one line: no holder check, so
  MCP took what the CLI refused; the replacement record was `{session, ts}` only, dropping
  `actor`/`worktree`/`branch`/`pid`, and `expired()` reads `claim.worktree` to notice a dead
  checkout — so a claim taken over MCP became permanently un-expirable and the next refusal
  degraded to "session bob"; and no `claim_stolen` event, so the only trace was a generic
  `update`.

  `tm_claim` had its own variant: it compared sessions but never asked `expired()`, so a claim
  left by a crashed session blocked an MCP agent forever while the CLI treated it as dead — two
  callers disagreeing about one piece of state.

  Every claim writer now goes through `claimTask`/`releaseClaim`: both MCP paths, `tm worktree
  new` (also a bare unlocked write that could not refuse), and `doctor`'s `dropClaim`, which
  read `state(p).claims` outside the lock and then called the locking `writeState` — the
  stale-read-then-locked-write shape. `steal` is exposed on both MCP tools so taking someone's
  work is deliberate and lands `claim_stolen`, and the refusal names it so an agent does not
  retry in a loop.

- **A closed reader crashed the CLI.** `tm board --json | head -1` wrote the first line, `head`
  exited, and the next write past the pipe buffer raised `EPIPE` on a stream with no error
  listener — an unhandled `'error'` event, so node died printing 1224 bytes of stack trace over
  whatever the user was reading. Every read verb funnels through the same two writers, and
  `bin/tm-mcp` had it too, where a vanished client is the *normal* way a session ends and the
  stream is contractually JSON-RPC only.

  Invisible on a small store, because the whole payload fits inside the 64 KB pipe buffer and
  the write completes before the reader is gone — so the fixtures passed and real repos failed,
  the worst possible schedule for a bug. One listener per stream in each entry point; anything
  that is not `EPIPE` is rethrown, so a real `ENOSPC` or `EBADF` still fails loudly rather than
  being swallowed into a silent exit 0.

- **A write that died mid-rename left a phantom task.** `writeAtomic` named its temp
  `${file}.${pid}.tmp` and `fileFor` resolved an id with `readdirSync(dir).find(f =>
  f.startsWith(`${id}-`))` — so that temp was a candidate answer for "where does TM-002 live".
  A crash during *create* left an entity that `tm show` rendered, `tm board` never listed
  (`list()` filters `.md`), `tm doctor` called clean, and `nextId` counted — burning the id so
  the next real task skipped it. Worse, `update()` read through `fileFor` and wrote back
  through `doc.file`, so you could add acceptance criteria to a phantom, comment on it and
  `tm start` it, leaving a task `in_progress` that even the Stop gate could not see (`gateStop`
  lists `.md` too).

  Three guards, because this failed silently once: the temp is now
  `.tm-tmp-<pid>-<name>` and cannot match `${id}-`; `fileFor` requires `.md`; and `nextId`
  requires `.md` so an interrupted write no longer reserves an id. `tm doctor` gained
  **`stray-temp`**, which reports a leftover temp of either shape and deliberately does not
  delete it — a temp file is the only surviving copy of whatever that write was carrying.

- **`tests/test-hooks.sh` depended on the host's PATH.** `autolink()` reports when something
  else already owns `tm` in `~/.local/bin`, which is true for every checkout except the one the
  symlink points at — so the suite failed its "silent before init" assertion when run from a
  git worktree. Pinned with `TM_NO_AUTOLINK=1`.

### Added

- **MCP resources: the board as context you pull, not only context the plugin pushes.**
  `initialize` answered `capabilities: {}` and every method except `tools/*` fell to `-32601`,
  so the only way board state reached Claude was the SessionStart injection or a tool the model
  chose to call. Seven resources now: `tm://board`, `tm://session`, `tm://graph`, `tm://blocked`,
  `tm://standup`, and `tm://handoff/<id>` per task in flight.

  Only computed views — a task, epic or ADR is a markdown file `Read` and `@` already reach, so
  a URI alias for a file path would just compete with the real file in the picker. `tm://graph`
  and `tm://blocked` have no tool behind them at all; `tm://session` is the one view compaction
  destroys that nothing else rebuilds.

  Also fixes a latent bug found on the way: **`capabilities` never declared `tools` either.**
  Claude Code is lenient enough that 18 tools worked anyway, but a stricter client is entitled
  to ignore an undeclared capability.

  `subscribe`/`listChanged` are deliberately not implemented — both need unsolicited stdout
  writes, which would mean threading a writer into `handleRequest` and losing the pure
  request-in/response-out contract that makes the protocol testable without a process.
  Every resource renders live at read time, so there is nothing to invalidate.

- **`touches` fills itself in, so `tm parallel` stops lying.** The field was documented in
  both README and AGENTS as "what `tm parallel` uses to decide which work can run at the same
  time", was read by `tm parallel` and printed by `tm show` — and **nothing ever wrote it**.
  Empty everywhere, every task looked disjoint from every other, so `tm parallel` put two
  tasks that rewrite the same file in one batch and told you to run them side by side. A
  `PostToolUse` hook on `Edit`/`Write`/`MultiEdit`/`NotebookEdit` now records the edited file
  against the task the session is holding, plus a `tm touches <id> [path...]` verb for
  declaring paths ahead of time.

  It attributes to a task it is sure about or to nothing: branch, then the single task in
  progress, then this session's claim. Two tasks running in one session is ambiguous and the
  edit is **dropped** — a path on the wrong task invents a collision that serializes work and
  hides the real one. Paths are relative to the **checkout**, not the store root, so the same
  file edited in two worktrees is the same path (anchoring on the root would have put every
  worktree edit under `.bytedesk/` and dropped it — blinding the feature exactly where parallel
  work happens). Failed edits are ignored, the store's own files are ignored, the list is
  capped at 40, and `tm config trackTouches false` switches it off.

### Fixed

- **Concurrent writes lost data, silently.** One store is shared by every worktree and
  the whole point of `tm parallel` / `tm claim` / `tm worktree` is several sessions at
  once, so simultaneous writes are the normal case. `withLock` existed but only guarded
  `state.json`: `create` did an unlocked `nextId` (max+1 over a directory read) then a
  write, and `update` an unlocked read-then-write. Measured on a scratch store:

  - **8 concurrent `tm task new` → 8 files, 7 distinct ids, 6 index rows.** A duplicate
    id is not cosmetic: `fileFor` resolves an id to the first matching directory entry,
    so the other file becomes permanently unaddressable — `tm show`, `tm start` and
    `tm done` can never reach it again.
  - **8 concurrent `tm comment` on one task → 5 stored, 7 of 8 processes exiting 0.**
  - **`tm doctor` then certified the wreckage.** Its only symptom was `index-drift`,
    `--fix` reindexed it away, and it reported "no problems found" over two files still
    claiming one id.

  The root cause underneath all of it: `openSync(lock, "wx")` creates the lock file
  **empty** and writes the pid a moment later. A second process arriving in that window
  read `""`, failed to parse it, concluded the lock was dead, unlinked it and walked in
  — so two processes held the "mutex" simultaneously. `staleLock` now falls back to the
  file's mtime, so a young empty lock is respected while a genuinely corrupt one still
  ages out.

  Also: `create` and `update` are now locked; a new `mutate(id, fn)` covers the
  read-append-write shape that wrapping `update` alone cannot fix (both callers read the
  same array, both append one item, second write wins) and the append callers are routed
  through it — comments, labels, links, acceptance criteria, evidence, dependencies,
  commit refs; `writeAtomic`'s temp file carries the pid, since a fixed `.tmp` is only
  atomic for one writer; `consumeOverride` and the Stop gate's `lastStopBlock` are locked,
  because a one-shot override token that two gates can each spend is not a gate.

- **`tm doctor` gained `duplicate-id`**, the error it most needed and did not have. Not
  auto-fixable: choosing which file keeps the id changes an identity that commits, links
  and dependencies already point at.

- **The dashboard dev server accepted a stale port file.** `dashboard.port` outlives the
  board that wrote it, so `npm run dev` would start happily against a dead port and then
  fail every request with a proxy error — which sends you reading the proxy config instead
  of starting the board. It now checks the recorded pid is alive and gives the same
  "no running board to proxy to" message it already gave when the file was missing.

### Documentation

- **HMR for the dashboard was already wired and entirely undocumented.** `npm --prefix
  dashboard run dev` serves the board with hot reload and proxies `/api` and `/events` to
  the running `bin/tm-dashboard`, so the UI is edited against live data from the real
  store. The README never mentioned it, so the only discoverable workflow was a full
  `npm run build` per change. Now documented, with the rebuild step and why `dist/` is
  committed.

## 0.3.0

### Fixed

- **The dashboard showed the wrong active epic.** The header lozenge and the burndown
  chart computed it as `epics.find(e => e.status !== "done")` — "the first epic that
  isn't finished" — rather than reading `state.activeEpic`, which the `/api/board`
  payload has always carried. With one epic they coincide; with two, both pointed at the
  wrong epic.

### Added

- **Epic swimlanes and an active-epic switcher.** Group by epic turns the five status
  columns into one row per epic, with a progress bar and `done/total` per lane; the
  active epic sorts first, then open epics by id, then closed ones, then unfiled work
  (never dropped). An epic id with no epic file gets a lane marked `missing` rather than
  hiding the tasks behind the fault. `POST /api/epic` switches the active epic with the
  same validation and event as `tm epic use`, and refuses a closed one rather than
  silently gating every later create — until now the only way to change it was the CLI,
  so the board could create tasks but not say where they land. Grouping sorts tasks
  lane-first, so the keyboard cursor keeps walking down the screen.

- **`tm export [md|csv|json|pm]`** — the capability the README has promised since v0.2.
  `md` is a report to paste into a PR or a standup; `csv` is RFC 4180 with Jira's column
  names and status vocabulary; `json` is the whole store as one document (`--events` to
  include the log); `pm` emits `pm_issue_create` payloads for the `project-management`
  plugin in this marketplace, plus the follow-up `transitions` that call cannot express,
  since it always creates at `TODO`. Filters: `--epic`, `--status`, `--open`; `--out
  <file>`, defaulting to stdout so it pipes. CSV escaping is verified against a title
  containing both a quote and a comma, a multi-line body, and multi-line criteria.

- **`tm doctor [--fix]`** — store integrity. Markdown-in-git is what makes the board
  readable and mergeable, and also why it drifts; `tm reindex` rebuilds the cache *from*
  the files, so it reproduces whatever is wrong with them. Checks dangling and one-sided
  dependency edges, one-sided and dangling Jira links, unknown link types, orphaned epic
  and parent references, dependency and subtask cycles, tasks left `blocked` with nothing
  blocking them, `done` tasks with unticked criteria, missing evidence files, duplicate
  `nativeId`s, claims on tasks that are gone / parked / finished, `in_progress` work
  nobody claimed, and `index.json` drift. **Exits 1 on any error-level finding**, so it
  gates a commit hook or a CI step. `--fix` applies only the unambiguous repairs, reports
  each one, and repeats until the store stops changing; cycles and unmet criteria are
  decisions, not typos, and are reported rather than touched.

- **A keyboard for the board, and a command palette.** The dashboard was mouse-only —
  cards moved by HTML5 drag and nothing else. `j`/`k`/`h`/`l`/`g`/`G` move a cursor,
  `1`–`5` move the focused card to that column (the number is printed in the column
  heading), `[`/`]` reorder within a column, `x` selects, `w` watches, `o`/`Enter` opens,
  `c` creates, `/` searches, `?` lists everything. `⌘K`/`Ctrl-K` opens a palette over
  every board action and every visible task. Cards became real focusable list items with
  `aria-label`s and a roving tabindex, so `Tab` and `j`/`k` agree. Shortcuts stay quiet
  while you type or while a dialog is open, and no modifier chord except `⌘K` is
  intercepted. Keyboard reordering needed no drag-and-drop library: `[`/`]` call the same
  `rank` endpoint the drop gesture already called.

- **`tm why <id>`** — why a task is not startable, walked to the root of its dependency
  chain rather than one hop deep. Reports the reason at each hop (a parked blocker's
  written reason, a claim another session holds, a hand-written `tm block`, the WIP limit,
  a dependency cycle, a `blockedBy` pointing at nothing) and names the work at the bottom
  as `roots`. `parked` is reported but not counted as blocking, because `tm start` resumes
  a parked task. Also available over MCP as `tm_why`.
- **`tm graph`** — the dependency graph as Mermaid, fenced so GitHub renders it inside a
  PR diff. `--epic` scopes it (blockers from outside the epic are still drawn, since they
  still explain the block), `--all` includes done work, `--raw` drops the fence, `--json`
  gives `{nodes, edges}`.
