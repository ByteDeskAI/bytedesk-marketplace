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

### Fixed

- **The claim interlock was only enforced on the CLI.** `tm start` refuses a task another live
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
