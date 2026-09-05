# Changelog

## Unreleased

### Added
- **The goal planner (EP-013).** A conversational surface at `/planner` where an operator states a
  goal in prose and an agent proposes board operations, which land only when the operator approves
  them. The agent talks ACP over stdio (`lib/planner-acp.mjs`); its stream is translated to typed
  AG-UI events (`lib/planner-agui.mjs`) so the dashboard renders turns, tool calls and permission
  requests without parsing prose. Sessions, turns and content-addressed attachments live in
  `lib/planner.mjs`; uploads are allowlisted by extension AND sniffed by magic bytes, stored under
  their sha256, and served with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`
  and a sandboxing CSP.

  The proposal itself is the governed part (`lib/planner-ops.mjs`). An agent can only ask for four
  operations — `epic.create`, `epic.activate`, `task.create`, `task.depends` — and it asks by
  calling one MCP tool, `tm_plan_propose`, from a narrowed tool table that exposes the board's reads
  and nothing that writes. A proposal is previewed through the same store gates the CLI obeys, shown
  as plain English consequences with the store's verbatim refusal where it refuses, digested, and
  applied only against that digest under a single reentrant store lock, rolling back every record it
  touched if any operation fails. Approving twice replays nothing.

- **The `topology` dispatch backend (TM-098, EP-014).** `lib/dispatch/topology.mjs` launches a
  one-agent orchestration through the sibling agent-orchestration plugin's tmux layer:
  `ao-topology launch --spec <spec> --consumer <tm's worktree> --json`. It reuses the checkout
  `tm dispatch` already provisioned and creates none of its own, which is ADR-0001's
  worktree-ownership rule (`agent-orchestration/docs/adr/0001-authoritative-orchestration-layer.md`)
  — one task, one worktree. When the consumer repo has an agent library
  (`.bytedesk/agent-orchestration/agents/`, or the legacy `.orchestration/agents/`) the worker
  borrows a stored agent's identity, cli chain, skills and system prompt, and the handoff is
  appended to that prompt rather than replacing it; a repo with no roster (or only a lead) gets
  an inline single-agent spec instead. argv-only with `shell: false`: the handoff travels as
  data inside the JSON spec file and as the durable worktree copy at `.tm-dispatch-prompt.md`,
  never as an argv element. The run handle is `topology:<tmux session>` — paste-able into
  `tmux attach -t`. Two new `tm config` keys: `dispatch.topologyAgent` pins which stored agent
  to borrow, `dispatch.topologyCandidates` sets the provider chain when there is no roster.
- **`collectTopology`.** `tm collect` reads a topology worker's liveness from its tmux session,
  the same coarse signal ADR-0001 names. `collectTmux` and `collectTopology` are now one
  implementation over the session in the run handle.
- **Pi harness integration (TM-081).** `pi` joins the harness line-up, measured against the
  installed 0.82.0 rather than docs: the CLI appears in `tm caps`; session identity comes from
  `PI_SESSION_ID` (verified exported to tool subprocesses); the work stream resolves
  `~/.pi/agent/sessions/--<cwd>--/*.jsonl` (raw events, no typed parser yet — the `kimi-wire`
  stance); and `hooks/pi-hooks.example.ts` is a Pi extension (in-process TypeScript — Pi has no
  shell hooks) forwarding session-start/session-end, commit linking, and edit touches. Its Stop
  equivalent is advisory (`ui.notify`), because a Pi extension cannot block an already-settled
  agent; the session-end park stays the deterministic half. Pi ships no native task tool
  (measured: no task-tool call in this machine's real session histogram), so its adapter is
  deliberately inert and tasks flow through the MCP `tm_*` tools. New `docs/harnesses.md` is the
  universal recipe: what works with zero integration, what each of the four integration points
  (hooks / session identity / native-task mirroring / work stream) adds, and the
  measure-then-land procedure for porting to a harness nobody has written an adapter for.
- **Install guide for consumer repos (TM-082).** New `docs/install.md`: adding the plugin to any
  local repository in install order — marketplace registration by relative path in
  `.claude/settings.json`, the git contract, bootstrap (`tm init`, the store's .gitignore split,
  `tm doctor` / `tm where` as post-install checks), per-harness wiring (Claude rides the plugin;
  Codex `.codex/hooks.json`; Kimi `[[hooks]]` + `.kimi-code/mcp.json`; Grok MCP-only), and
  updating (no version pins — every marketplace commit is a new version; stale-cache tells).
  Verified end to end against a scratch repo with a clean HOME, including the fresh-clone
  re-bootstrap. The README install block points at it, and the Notes section no longer lists the
  generated launchers as committed — the store's .gitignore ignores `bin` and init rewrites them
  per host.
- **Required-field completeness gates (TM-080).** A task now carries its details or the
  gates say no. New `lib/completeness.mjs` — `missingFields(task, required)` returns
  `[{field, hint}]` with the hint naming the exact fix command (`tm edit <id> --body`,
  `tm ac <id> "…"`, `tm evidence <id> <path|->`, `tm assign <id> <who>`) — and three config
  field-lists, on by default and in the settings catalog: `requireOnCreate`
  `["body","acceptance"]`, `requireOnStart` `["body","acceptance"]`, `requireOnDone`
  `["body","acceptance","evidence","actor"]`. An explicit create (CLI `task new`, MCP
  `tm_task_create`, `POST /api/task`) is refused without context and criteria, so
  `task new` gains `--body <text|->` (`-` reads stdin, like `edit --body -`) and a
  repeatable `--ac "criterion"`; harness-mirror creates (`TaskCreate`, `update_plan`,
  `todo_write`, `TodoList`) are exempt. `gateStart` now refuses an incomplete task, which
  binds `tm start` and `tm dispatch` on every surface; `gateDone` adds the body,
  at-least-one-criterion-exists (closing the zero-AC hole — a task with no criteria could
  close before), evidence, and actor-or-assignee checks on top of `requireAcceptance`.
  Mirror-created tasks are never blocked at done; `tm doctor` audits them report-only as
  `incomplete-done` and `incomplete-open` warnings. Everything bows to the existing escape
  machinery: `TM_ENFORCE=off`, a one-shot `tm override "<reason>"`, or `tm config`.

- **Use-case catalog (TM-075).** [`docs/use-cases.md`](docs/use-cases.md) — 20 situations
  in one five-section format (Scenario / When to use / Usage / Natural language prompts /
  Expected outcome), spanning classic board work and the agent-first loop. README Docs
  table links it. Not committed as a release; left in the tree for review.

- **Agent-first documentation and skills (TM-074).** [`docs/agent-first.md`](docs/agent-first.md)
  is the three-surface map (CLI / 38 MCP tools / HTTP) for `caps`, `dispatch`, `pool`,
  `collect`, `agent`, and `events` — flags, refusals, backend order, config keys, and
  Claude/Codex/Grok/Kimi recipes. Skills `caps`, `dispatch`, `pool`, `collect`, `agent`,
  `events` chain that loop so a new agent can find it from metadata without guessing a
  flag. README links the doc from the agent-first section, the MCP inventory, and the
  dashboard write table.
- **Agent-first: dispatch, the pool, and the machine bus.** The board is now something an
  agent runs on, with the split of labour kept deliberate: humans decide (decision-map and
  enhance gates), agents execute `ready-for-agent`-labelled work.
- **Host capability detection and `tm caps`.** `lib/hostcaps.mjs` probes what this host can
  dispatch work to — the agent-orchestration MCP binary (env override → sibling plugin in a
  marketplace checkout → Claude plugin cache), fleet's `spawn-claude-feature`, tmux, the
  harness CLIs, and the sandbox binaries the orchestration backend degrades without. Every
  probe is individually failure-tolerant: a missing dependency is `available: false` with a
  reason, never an exception. `tm caps [--json]` renders it; `GET /api/caps` serves it.
- **Dispatch: one verb for the whole hand-off** (`lib/dispatch/`). `tm dispatch <id>
  [--backend <name>] [--steal]`, MCP `tm_dispatch`, and `POST /api/task/:id/dispatch` share
  one `dispatch()`: claim, mark in_progress (dispatch IS a start — `gateStart` binds on all
  three surfaces), provision the worktree, render the handoff, launch a backend. Any failure
  after the claim releases it and restores the status. Backends walk **orchestration → fleet
  → tmux → manual** (config `dispatch.backends` overrides); every one launches argv-only with
  `shell: false`, so a markdown prompt is never shell source. Orchestration speaks MCP as a
  stdio client with an idempotency key (`<task>-<session>`) so a retried dispatch collapses
  onto the same run; tmux names its session `tm-<id>` and drops the durable prompt at
  `.tm-dispatch-prompt.md`; fleet shells out to `spawn-claude-feature` with
  `CLAUDE_SESSION_TICKET` set so the recursion guard engages; manual is the floor that hands
  the work to a person.
- **The agent registry: heartbeats and a reaper** (`lib/agents.mjs`). Dispatch registers every
  worker it spawns in `agents.json` — per-machine runtime state, added to the store's
  gitignore contract beside `state.json`, because whose workers on whose laptop is not the
  shared record. Liveness is derived (live pid, or a heartbeat fresher than
  `agentTtlMinutes`, default 30; 0 disables). A dispatched claim is held by liveness: a
  heartbeat loop re-stamps it every `dispatch.heartbeatSeconds` (default 60; 0 disables) and
  stops itself when there is nothing left to keep alive. `tm agent list | heartbeat <name> |
  reap`, MCP `tm_agents`, `GET /api/agents`. Reaping marks quiet agents dead **and unparks
  the board behind them** — a dead worker's claimed tasks are parked with the reason and
  their claims released, so a dead worker never leaves in_progress work nobody is doing.
  Every registry call is failure-tolerant: a broken `agents.json` is a missing panel, never a
  failed dispatch.
- **The result protocol** (`lib/dispatch/collect.mjs`). Each backend's collector reads its own
  completion signal — orchestration run state, tmux session liveness, fleet ticket events —
  and normalizes it into `recordResult`, the single write path. The acceptance gate stays the
  real gate: a collector never closes a task, a "done" report on a task that is not done
  downgrades to failed with the status named, and failure on a task still in_progress parks
  it with the worker's summary as the reason. Everything lands as a comment plus one
  `task_result` event. `tm collect <id>`, MCP `tm_collect`, `POST /api/task/:id/collect`.
- **The webhook event bus** (`lib/webhooks.mjs`, `bin/tm-webhook`). Every event that lands in
  `events.jsonl` is POSTed — the exact JSONL row — to each URL in config `webhooks`
  (`[{url, kinds?}]`). Loopback only (`127.0.0.1`, `localhost`, `*.local`, plain http) unless
  the project sets `webhooksAllowRemote: true`; delivery rides a detached child because a
  hook process exits in milliseconds. The pull side is `tm events [n] [--follow]
  [--since <iso>] [--json]` — JSONL with a byte-offset tail that survives log rotation.
- **The worker pool.** `tm pool once|start|stop|status
  [--dry-run]`: scans for open, unblocked, unclaimed `ready-for-agent` tasks and dispatches
  up to `dispatch.poolWip` (default 3) every `dispatch.pollSeconds` (default 30), collecting
  finished workers first so a terminal result frees its slot. `dispatch.backendCaps` adds
  per-backend ceilings on top of poolWip (e.g. `{ "tmux": 2 }`), and the interactive
  `wipLimit` is untouched — the pool never consults it. Opt-in —
  `dispatch.enabled` defaults to `false`; the `tm-pool` monitor runs it. The pool never
  touches unlabelled work: the label is the human's go-ahead. The agents-group settings
  (`dispatch.enabled`, `dispatch.poolWip`, `dispatch.pollSeconds`, `dispatch.heartbeatSeconds`,
  `agentTtlMinutes`) are in the shared settings catalog, so the dashboard can write them.
- **Kimi harness adapter** (`lib/harness/kimi.mjs`). Kimi Code's native `TodoList` mirrors
  into the store exactly like Codex's `update_plan` — rows keyed by a content hash of the
  title, so re-sending the same title updates the same task; a query-mode call (no `todos`)
  is a read and never trips the pre-create gate. Hooks wire through `[[hooks]]` entries in
  `~/.kimi-code/config.toml` (`hooks/kimi-hooks.example.toml`); Kimi exports no session env
  var, so the session id reaches the store off the hook payload, the same path Codex takes.
- **Worker-mode subagent brief and the Stop-gate exemption.** `briefFor` in `lib/render.mjs`
  briefs a dispatched worker on its own task's completion contract, distinct from the
  fan-out brief a parent's subagent gets; a dispatched task no longer blocks the Stop gate —
  its liveness is the heartbeat loop and the reaper's job, not the dispatching session's.
- **MCP: three agent-first tools** — `tm_dispatch`, `tm_collect`, `tm_agents` — taking the
  server from 35 to **38 tools** (verified against `tools/list`).
- **Inspectors float.** An open task, epic, sprint, decision or capability inspector overlays the
  canvas at every width instead of taking a grid column; the board keeps its full width and
  stays interactive on desktop, gets a scrim on tablets, and fills the screen on phones.
- **Dashboard grading rounds 2–3 (PASS).** Phone command bar fits 390 px (search shrinks, live
  word becomes its dot with an aria-label, theme toggle lives in Settings), inspector controls are
  44 px on phones, inspector heads wrap instead of pushing the close button off-panel, long mono
  values break on phones, Modal owns Escape. Final grade: coverage 5, keyboard 5, performance 5,
  tests 5, design 4, accessibility 4, responsiveness 4; zero P0. Board columns keep a 200 px
  minimum beside a wide inspector and scroll in their own box; Help commands take their own line.
- **Dashboard grading round 1 fixes.** Goal import from `/plans` and the epic inspector; templates
  and per-kind ntfy toggles (`ntfy.categories` joins the settings catalog) on `/settings` with a
  section list; `?` opens a shortcuts sheet over any screen; 44 px touch targets below 720 px;
  light-theme chip tints; board filters fold into one `tm find` query bar with a disclosure;
  phone board opens on the first non-empty status and the phone backlog is compact cards; reports
  use one measure strip; standup fills the canvas; History tabs on decision and capability
  inspectors; browser tests pick a free debug port and attach only to their own page.
- **Dashboard rewrite, wave 2 (screens) + integration.** The board is a multi-screen app on the
  ByteDesk design system: Board, Backlog, Epics, Task inspector (why chain, history, evidence,
  worktree, work stream), Decisions, Capabilities, Plans, Graph, Activity, Standup, Sprints,
  Sessions (claims, WIP, worktrees, parallel batches, subagents), Doctor, Search (`tm find`
  syntax), Reports (cycle time, throughput, export), Settings (dirty state, ntfy test, override),
  Help (shortcuts, skills catalog). Deep links, inspector-over-list routing, optimistic writes with
  rollback, offline outbox, PWA precache on token colours. Browser tests gain `routes.mjs`.
- **Dashboard design run.** `docs/design/2026-09-01-tm-dashboard/` holds the brief ("The
  Register": resume work from the record alone), three direction pieces, nine token-accurate HTML
  surfaces with screenshots, and the blind review (`review/findings.json`, zero blocking).
- **MCP parity (CAP-0001 shipped).** Eleven tools mirror the board's routes on the same lib
  functions and refusal wording: `tm_worktree`, `tm_link`, `tm_graph`, `tm_doctor`,
  `tm_export`, `tm_time`, `tm_parallel`, `tm_task_field`, `tm_history`, `tm_stale`,
  `tm_goal_import`; `tm_task_update` gains `delete` and `restore`. 35 tools in all.
- **Dashboard rewrite, wave 1 (frontend core).** The SPA foundation is rebuilt on the ByteDesk
  design system: `--tm-*` semantic roles aliased to `--bd-*`, self-hosted IBM Plex, Lucide
  icons, a history router with deep links and an inspector layer, an SSE-fed entity store with
  optimistic writes and rollback, 27 token-only UI primitives, and an app shell (rail, command
  bar, palette, help). `@atlaskit/*`, `@compiled/*` and `@tanstack/ai-react` are removed;
  the vendor chunk drops from ~3.3 MB to ~49 kB gzipped.
- **Dashboard rewrite, wave 1 (backend).** Every CLI-only verb has an HTTP route: `/api/meta`,
  `/api/graph`, `/api/standup`, `/api/time`, `/api/task/:id/{why,handoff,time,history}`,
  `/api/entity/:id/history`, `/api/stale`, `/api/find`, `/api/claims`, `/api/parallel`,
  `/api/ntfy`, `/api/override`, `/api/doctor`, `/api/sessions`, `/api/skills`, `/api/export`;
  writes `/api/doctor/fix` and `/api/claims/sweep` (both need `{confirm:true}`),
  `/api/task/:id/{claim,release,delete,restore}`, `/api/override`, `/api/ntfy/test`,
  `/api/goal/import`, `/api/reindex`, template create/update, and `PATCH` on epic/ADR/sprint/
  capability. One `gateStart` WIP check shared by the CLI, MCP and the board (the board could
  exceed `wipLimit` before). SSE frames carry `id:` (byte offset), `event: store|ready|resync`,
  a 25 s heartbeat and `Last-Event-ID` replay; `/api/events?since&limit&id`; ETag on `/api/board`.
  Lifted `lib/parallel.mjs`, `lib/goal-import.mjs`, `lib/skills.mjs`, `worktree.provision`,
  `templates.writeTemplate`; settings catalog gains `eventMaxBytes`, `branchPrefix`,
  `worktreeDir`, `worktreeShare`; new `deleted` event kind.
- **Dashboard rewrite, wave 0.** The repository adopts the ByteDesk design system for the
  dashboard (`bd-design init --app task-management`; profile authored upstream, inherits the
  gateway accent). `docs/dashboard-api.md` is the HTTP/SSE/MCP contract and
  `docs/dashboard-contract.md` the frontend contract that the rewrite's workers code against.
- **Decision-map flow** (generic `/task-management:*` names). Skills `map`, `interview`, `research`, `prototype`, `spec`, `tickets`, `implement`, `route`. Store labels `decision:map` (epic), `decision:interview|research|prototype|unblock` (tickets). Templates `interview`, `research`, `prototype`, `unblock`.
- **Label catalog.** Canonical decision + triage roles, exclusive within each group. `.bytedesk/task-management/bin/tm label --catalog`, MCP `tm_label`, `tm_task_create.labels`. Dashboard catalog picker, semantic chips, palette "Label as …", seeded saved views. Map epics chip `map` plus remaining-fog count on the lane. Decision cards chip HITL/AFK and **needs answer**. The task drawer has an Answer field; map epics split Destination / Decisions so far / fog / Out of scope.
- **Decision done gate.** `.bytedesk/task-management/bin/tm done` / dashboard Done refuse a `decision:*` ticket until `## Answer` is written. Prototype and research also need evidence.
- **Project-local commands.** `tm init` writes `tm`, `tm-hook`, and `tm-dashboard` launchers (plus Windows `.cmd` twins) under `.bytedesk/task-management/bin/`. They discover the installed plugin at runtime without a committed home-directory path.
- **Settings catalog.** `GET /api/settings` plus a settings page for every project-scoped option that is safe to write (dashboard, policy, workflow, ntfy). Identity (`boardId`/`owner`) is read-only. `board.launchBrowser` opens the default browser when the dashboard starts.

- **Tool-call markup is refused at the store boundary.** A body containing an agent's own `<parameter …>` / `<invoke …>` fragments is rejected by `write()`, so every entry point is covered — CLI, MCP, the dashboard's `PATCH /api/task/:id`, and the harness bridge mirroring a native `TaskCreate`. Eleven records were written with their own tool calls embedded before this existed, including one whose entire body was replaced by another task's progress note; the store accepted all of it silently. The check matches the corruption's shape (a tag alone on a line, at the start of one, or trailing at the end of the body) rather than the substring, and skips fenced code so documenting the rule still saves.

### Changed
- **The test that proves the read-only planner profile writes nothing now reaches the code it is
  about (TM-086).** It called every tool with one bag of hostile arguments, and `tm_plan_propose` —
  the only tool on that surface that can write — has no `operations` key in it, so the call died at
  argument validation. The test existed because "comparing the allowlist to itself would have
  passed the whole time", and for the one tool that matters it was doing exactly that: it passed
  unchanged while previewing was spending the operator's override. It now calls each tool with
  arguments it accepts, from inside a real planning session, against a board at its WIP limit with
  an override pending — and it fails when the defect is put back.
- **`dispatch.backends` defaults to `["topology", "tmux", "orchestration", "manual"]`
  (TM-098).** ADR-0001's migration order. `topology` is the authoritative layer for dispatched
  work; raw `tmux` stays beneath it as the fallback until topology passes the same contract
  tests; `orchestration` is **demoted** to an explicit `--backend orchestration` choice for
  untrusted autonomous writes, because its runtime derives a second, detached worktree by
  invariant; `manual` remains the floor that can never disappear.
- **`tm caps` reports `topology` where it reported `fleet`.** The probe resolves
  `bin/ao-topology` (env `TM_TOPOLOGY_BIN` → sibling `agent-orchestration/` → Claude plugin
  cache) and, like the fleet probe before it, fails when tmux is absent — tmux panes are where
  its agents live. The two agent-orchestration binaries are probed independently, so half an
  install fails exactly one backend.
- **The README describes the rewritten dashboard** (TM-052, TM-053). The board sections are
  rewritten around the multi-screen app: every screen and the route it lives at, the
  inspector-over-list model (`/tasks/<id>` over the list you came from, back closes it), the live
  entity store, the keyboard map, what the browser is allowed to write, the dev loop, and the
  browser tests that are not part of `run-tests.sh`. The stale claims go with it — the Atlaskit
  component library and the drawer-era five-column board — and `ntfy.categories` joins the
  documented settings catalog, which now names the gates (`enforce`, `wipLimit`,
  `requireAcceptance`) the board and `tm config` write the same way. `docs/dashboard-api.md`
  follows the same rename.
- **Dashboard dependencies removed.** `@atlaskit/*`, `@compiled/*`, `@tanstack/ai-react`; the served bundle is ~70 kB gzipped in total.
- Worktree `hardlink` share copies on Windows instead of calling `cp -al`.
- **Global command installation and SessionStart autolinking are removed.** Repositories invoke the committed launchers under `.bytedesk/task-management/bin/`; `.bytedesk/task-management/bin/tm doctor --fix` removes legacy links only when they are proven to belong to this plugin.
- **Generated runtime files stay out of git.** Store `.gitignore` now names `dashboard.pid` and `dashboard.port` explicitly (still covered by `dashboard.*`), plus `bin` (generated launchers) and `events.json` / `events.jsonl`. Bootstrap and `.bytedesk/task-management/bin/tm doctor --fix` write `.bytedesk/.gitignore` so `worktrees/` is ignored without swallowing the store. Dashboard `.gitignore` also drops Vite/tsc leftovers (`.vite`, `*.tsbuildinfo`).

### Fixed
- **Test runs leaked their throwaway stores.** `tempStore()` and `tempRepo()` relied entirely on
  each test file remembering `cleanup()` in an `after()` hook, so a file that forgot one leaked and
  so did every interrupted run — a killed soak, a crash, a filtered run that never reached the hook.
  Four days of that left 11,034 directories and 1.1 GB in the system temp dir. The helper now
  removes what it handed out on process `exit`, which covers a normal end and an uncaught throw
  alike; a full suite run leaks nothing, and a run that dies mid-test cleans up too.
- **One override, two operations, nothing landed (TM-086).** Introduced by the fix above and caught
  by the round after it. `check` no longer spends the token, so every operation that needed it
  reported valid — and the apply then spent one token PER OPERATION, so the second failed for want
  of a second token. A preview and an apply that disagree, and the failed attempt burnt the token so
  the retry failed too. An override is one operator decision authorising one approved proposal,
  which is the granularity of a landing, not of an operation.
- **Crash recovery ran without the store lock (TM-086).** `reopenIfStranded` called it unlocked, so
  the undo's unlinks could remove a record another process was between reserving and writing — a
  window the id reservation makes more likely, not less.
- **The crash-recovery sweep deleted other people's work (TM-086).** Introduced in this same round
  and caught by the review that followed it. Recovery removed every record stamped at or after the
  interrupted landing began, reasoning that the landing held the store lock so nothing else could
  have created anything. The lock dies with the process; the journal does not. A dashboard killed on
  Monday, a week of ordinary `tm task new`, and the first person to reopen the stranded session on
  Friday would have deleted the week — silently. The sweep is gone: a landing now RESERVES each id
  under the lock it already holds and journals it before the record exists, so recovery only ever
  undoes what is written down.
- **A rebound hostname could write to the board (TM-086).** The origin check compared `Origin` to
  `http://${req.headers.host}` — two values the attacker supplies. A page on a domain that resolves
  to 127.0.0.1 sends both, they match, and the browser calls it same-origin. The `Host` is now
  checked first, against the port the server actually bound and a set of loopback literals.
- **The journal was the least crash-safe part of the crash recovery (TM-086).** It was the one file
  in the store written non-atomically, so a kill mid-write left JSON that would not parse — and an
  unparseable journal undid nothing, silently. It uses `writeAtomic` now and says so loudly.
- **A record modified but not yet journalled was never restored (TM-086).** The journal was written
  after each operation while `ctx.touch()` snapshots happen inside one, so a kill during the
  operation that edits a pre-existing record lost that snapshot — the ordinary case for
  `task.depends`, which writes both ends of an edge. `touch()` journals as it snapshots.
- **A journal's restore target was unvalidated (TM-086).** The snapshot's `file` is handed to
  `write` as the path to write, and the journal comes off disk, so it is input rather than a value
  this process computed.
- **`propose` threw away its own refusal (TM-086).** It threw `fail(...).body` — `{error}` with no
  `status` and no `message` — so the outer catch turned a considered 409 into
  `400 {"error": undefined}` and the operator was told nothing.

- **A rollback that could not finish still handed the approval back (TM-086).** Every step of the
  undo is best effort — a file that will not unlink, a record that will not write — and it said
  nothing about a step that failed, while the route treats any throw as "nothing landed". A partial
  undo therefore re-armed the proposal and invited the operator to create the leftovers a second
  time. The undo now reports what it could not undo, and the route refuses to offer that proposal
  again, naming the records to check instead.
- **A label could be mistaken for a forward reference (TM-086).** The ref scan walked every
  argument, so a task labelled `mfa` alongside a later operation declaring `{ref:"mfa"}` had the
  whole proposal refused — with a message describing something the agent had not done, so it could
  not correct itself either. Only `epic`, `task` and `on` can hold a reference, and only those are
  scanned.
- **An interrupted landing stayed half-applied for ever (TM-086).** `applyOps` and
  `applyManifestPlan` both claimed "all of it or none of it", and both meant it only for a failure
  that THROWS: kill the process after the epic was activated and the first task written and those
  records survived, with no error anywhere and a session marked "applying" that could say nothing
  about what had landed. Records are written one file at a time and nothing makes that atomic, so a
  landing now writes down its intent first — what it has created, and the originals of everything it
  modified — and the next attempt, or the route that reopens a stranded session, undoes it. The one
  window the journal cannot name directly, between a record being written and the journal naming it,
  is swept by timestamp: the landing holds the store lock, so nothing else created anything while it
  ran.
- **Any other page on localhost could write to the board (TM-086).** The same-origin check accepted
  every `http://127.0.0.1:` and `http://localhost:` prefix — i.e. every port on the machine — and
  skipped entirely when no `Origin` header was sent, which is exactly what a simple `text/plain`
  form post does. Another local dev server could create and activate an epic with no CORS
  permission at all. An `Origin` must now match this server's own, and `Sec-Fetch-Site` catches
  what `Origin` misses.
- **A bookkeeping failure refunded a spent approval (TM-086).** `closeSession` sat inside the
  `try` that catches a failed landing, so a session-write error after a SUCCESSFUL apply put the
  proposal back and let the same digest create everything a second time.
- **Rollback could leave two files for one task (TM-086).** The restore dropped the snapshot's
  `file`, so `write` derived a path from the title instead: a task renamed since its file was named
  came back as a second file, the index counted both, and the original kept the edit the rollback
  existed to undo.
- **The confirmation dialog could switch proposals underneath the operator (TM-086).** Reviewing
  proposal A while a run finished loaded B without withdrawing the review, so the already-enabled
  Apply sent B's digest — arguments nobody had seen.
- **The epic exemption skipped every later gate (TM-086).** Forgiving the "no active epic" refusal
  at the call site could not work: that check RETURNS, so completeness and WIP were never reached,
  and with no active epic a proposal naming an existing one validated past both. The gate is told
  the epic is supplied and skips that one rule.
- **A manifest could still import a dependency cycle, or two goals with one id (TM-086).** Manifest
  edges were written with raw mutations, walking past the same refusal `task.depends` had just been
  fixed to obey; and a duplicate goal id created two tasks while pointing both goals' dependencies
  at the second. Both are refused while the import is still a plan.
- **A symlink could still smuggle a goal document out of the repository (TM-086).** The manifest's
  referenced documents were confined on their real path; the `path` a preview or import is handed
  was checked lexically, so a link inside the repo pointing anywhere passed.
- **A malformed URL took the dashboard down (TM-086).** `decodeURIComponent` ran outside any
  handler, so `GET /api/planner/%/attachment/<hash>` threw `URIError` out of the request callback.
- **The run buffer counted events, not bytes (TM-086).** An agent framing correctly could send
  hundreds of large valid updates and hold gigabytes long before the two-thousandth arrived.
- **Sessions listed "newest first" in an arbitrary order when timestamps tied (TM-086).** The sort
  fell back to `readdirSync` order, so a list could reorder between two refreshes for no reason the
  operator could see.
- **An agent could still end the host process through one field (TM-086).** `{"error":{"message":
  {"toString":null}}}` is a value that throws `TypeError` on any string coercion, and both
  `new Error(x)` and a template literal coerce — so the throw happened inside a stdout listener,
  outside every promise, and took the dashboard down. Same shape as the `JSON.parse("null")` crash
  reached through a different field. Agent text is coerced safely now, and the response listener is
  fenced like the update one already was.
- **A proposal could land a dependency cycle the CLI refuses (TM-086).** `task.depends` wrote both
  ends of its edges with a raw `mutate`, walking straight past the cycle refusal in
  `dependencies()` — and `tm doctor` deliberately will not repair a cycle, because which edge to
  cut is a judgement. It now goes through the store's own writer, and the cycle is refused at
  preview, checked against the board's edges and against the ones earlier operations in the same
  proposal add, so an operator is never asked to approve a set the apply will refuse halfway.
- **A crash mid-apply stranded a planning session for good (TM-086).** Claiming the proposal set
  the session to "applying"; a crash or a restart before the apply finished left it neither open
  nor holding anything to approve, and no request could move it again. The apply route now knows
  which sessions this process is really applying, so an "applying" session nobody is applying is
  reopened — one re-proposal instead of a hand-edited file.
- **A broken agent could exhaust the board's memory (TM-086).** The ACP bridge framed the agent's
  stdout with `readline`, which buffers an unterminated line without limit. Framing is done here
  now, with a 4 MB ceiling: a frame past it drops the agent and fails the run with the reason.
- **Every finished planning run stayed in memory (TM-086).** A dashboard left running kept the
  full event trace of every run it had ever done; the twenty most recent are kept and the rest are
  dropped, since what a reload needs — goal, turns, proposal — is on disk.
- **A manifest import could lose the active epic on rollback (TM-086).** `activeEpicChanged` was
  set after the `writeState` it describes, so a write that threw part-way left the flag false and
  the compensation skipped the one thing it exists to put back.
- **The planner honoured the board's gates only when it felt like it (TM-086).** A preview
  discarded the store's refusal whenever an epic already existed, so a proposal walked straight past
  the WIP limit and the required-field checks: the board refused, the card said "validated", and the
  tasks were created anyway. Every refusal is now honoured; the one exception is "no active epic",
  which is not a refusal when the proposal creates the epic it is asking about.
- **An approved proposal could land somewhere the operator never saw (TM-086).** A `task.create`
  with no explicit epic resolved its destination during apply, so switching the active epic between
  preview and approval redirected the work. The destination is now resolved before the digest is
  taken, named on the card, and bound by the approval.
- **`tm collect` could never see an orchestration run it dispatched (TM-098).** Dispatch spawns
  with `consumerCwd = <tm worktree>`, so the run records that checkout's `repositoryKey`
  (`sha256(commonGitDir\0checkoutRoot)`); collect asked with the repo root, a different hash,
  and every `getRun` answered `AO_RUN_REPOSITORY_MISMATCH`. Collect now asks with the task's own
  `worktree` field — the exact value dispatch passed — falling back to the repo root for a
  record that has none.
- **A `write` dispatch could be refused for tm's own leftovers.** agent-orchestration resolves a
  `write` consumer with `requireClean`, asserting `git status --porcelain --untracked-files=all`
  is empty (`AO_CONSUMER_DIRTY`). `createWorktree` now excludes `.tm-dispatch-prompt.md` in the
  worktree's git dir at creation — before any backend can write it, and regardless of whether
  sharing is on — and `applyShares` excludes a shared path it finds already present instead of
  skipping past the exclude, which is the path a re-provision takes.
- **A unit test read the ambient session id instead of its own fixture.** `dashboard-api`'s actor/session stamping test set `CLAUDE_SESSION_ID`, which `CLAUDE_CODE_SESSION_ID` outranks in the `SESSION_ENV` chain — so it passed in CI and in a bare shell and failed only when run from inside a Claude Code session. New `withSessionEnv()` test helper clears every variable in `SESSION_ENV` before setting the ones under test, deriving the list from the source of truth so adding a harness cannot reintroduce the leak.
- **The MCP parity suite depended on the ambient session.** `mcp.test.mjs`'s worktree test only
  exercised the claim interlock when `CLAUDE_CODE_SESSION_ID` happened to be set by whatever ran
  the suite — harnesses like Kimi export none. The test now pins its own session ids and restores
  the ambient one (or unsets it) afterwards, so it proves the interlock everywhere.
- **The keyboard browser test measured the wrong column in grouped mode** (TM-057). Grouped mode
  renders the same status column once per lane and `j` walks that whole status down the screen, so
  counting the cards in one `[role=list]` under-measured the column and the move-or-clamp
  assertion could read a legitimate move as a failure. `keyboard.mjs` now counts depth across
  every `[data-tm-column]` carrying that status, and `l` asserts the contract it actually has —
  cross to the next non-empty column when one exists to the right, stay put when the cursor is
  already in the last one — instead of assuming there is always somewhere to go.
- **Re-dispatching a live task failed in git and released the worker's claim.** A second
  `tm dispatch` of an already-dispatched task re-claimed idempotently (same session), died in
  `git worktree add` ("already exists"), and the rollback then released the LIVE worker's claim
  and reverted the status — the board lost track of running work. `dispatch()` now refuses up
  front when the task carries a dispatch record AND a live claim ("already dispatched … collect
  it first, or steal it deliberately with --steal"), and its rollback only releases a claim the
  call itself created. A harness-less dispatch also synthesizes a session (`dispatch-<id>`) so
  the claim interlocks and the worker's `TM_SESSION_ID` is never empty.

### Removed
- **The `fleet` backend (TM-098, EP-014).** `lib/dispatch/fleet.mjs`, the fleet collector, the
  `fleet` entry in `DEFAULT_ORDER` and the `spawn-claude-feature` host-capability probe and its
  `tm caps` line are all gone; the `fleet` plugin is retired. Its depth-based authorization
  taxonomy was salvaged first under TM-095. A `dispatch.backends` config that still names
  `fleet` degrades to "module not present" and falls through, as it does for any unknown name.

## [0.14.0] — 2026-08-18

Store-folder dashboard integration (BDM-64–74). Internal plugin.json stays unpinned.

### Added
- **Deferred extras** (BDM-74). `GET /api/worktrees` lists
  `.bytedesk/worktrees/` via `listWorktrees` (`[]` when none).
  `POST /api/task/:id/worktree` `{ action: "create"|"remove", force? }`
  delegates to `createWorktree` / `removeWorktree`. TaskDrawer shows
  `task.worktree` / `task.branch` with create/remove; worktree file
  contents are never served. `removeLink` drops a typed link on both
  ends (foreign refs stay one-sided) under `mutate`. Dashboard:
  `POST /api/task/:id/unlink` `{ type, to }`, or `POST .../link` with
  `{ remove: true }`; each LINKS row has a remove control.
  MCP `tm_sprint` mirrors CLI show/new/use/add/rm/done/list on the
  same store functions. `GET /api/entity/:id` is generic `kindOf` +
  `read` (404 missing, 400 unknown prefix) and does not replace
  per-kind routes — `GET /api/task/EP-*` stays 400. One real
  capability card is seeded under `capabilities/` via `propose()`
  semantics. `tm_cap_drop` and the ExitPlanMode payload-path chooser
  were already on this SHA.
- **Sprints on the board header and filter** (BDM-71). `/api/board` includes
  `sprints` (body-stripped; `[]` when `sprints/` is empty). The header lozenge
  shows `sprintReport` points (`N/M pts · K unsized`) beside the epic —
  sparkline stays card counts. Toolbar **This sprint** filters `task.sprint`.
  TaskDrawer and BulkBar commit/remove via `POST /api/task/:id/sprint`.
  `POST /api/sprint` `{ title, ends? }` creates and sets `activeSprint`;
  `{ id }` activates. `GET /api/sprint/:id` is the full record plus report
  numbers. `POST /api/sprint/:id/done` closes and clears the active pointer
  if it was this one — unfinished cards stay on the board with `sprint`
  still set. Create task does not auto-commit to the active sprint.
  `GET /api/task/SP-*` stays 400. `reindex()` now indexes `sprints/`.
  Doctor reports a dangling `task.sprint`; `--fix` clears the field.
  **`activeSprint` stays machine-local** (`state.json`); it is not added
  to `SHARED_STATE`. `activeEpic` is shared because every `tm task new`
  files under it. A sprint is a local work rhythm; two checkouts can
  filter different sprints; the CLI already writes `activeSprint` via
  `writeState` into state.json. `boardPayload.state` already sends
  `state(p)`.
- **Plans inbox and epic.plan renderer** (BDM-72). Plans stay a derived
  inbox, not a KIND: `GET /api/plans` is a readdir of `plans/` (`[]` when
  empty), joined with the epic that points at each file. `GET /api/plans/file?ref=`
  is 200 only when the realpath sits inside `p.plans` or is the exact
  `epic.plan` file — traversal and paths outside are 404. `POST /api/epic/:id/plan`
  sets or clears the pointer. The drawer PLAN section renders `.md` as
  markdown and `*.plan.json` via `parseManifest` (title + goals, not a dump).
  EpicLane chips a linked plan. The inbox sits beside the board, not as a
  sixth column; unlinked files stay visible. `tm show` prints `plan:` when
  set. Doctor reports dangling `epic.plan` and unreferenced `plans/*`
  without deleting them. ExitPlanMode capture prefers the payload path when
  that file exists, else newest-mtime.
- **Enhance panel for capabilities** (BDM-73). `/api/board` includes `capabilities`
  (ranked, body-stripped; `[]` when `capabilities/` is empty). `GET /api/capability/:id`
  returns the full record. `POST /api/capability` proposes; `/:id/accept` mints the
  task; `/:id/ship` is 409 without evidence (CLI wording); `/:id/drop` takes `{ why? }`.
  `GET /api/task/CAP-*` stays 400. Caps stay off the kanban — the panel sits beside
  the board. Accept / Drop / Ship; ship is disabled until `evidence.length`. Task
  drawer shows `task.capability` as a chip; epic lanes list caps only via the
  minted task's epic; palette jumps to `CAP-*`. MCP `tm_cap_drop` (also BDM-74)
  and `tm_cap_propose` impact help is `H | M | L`.
- **ADRs on the board** (BDM-70). `/api/board` includes `adrs` (body-stripped; `[]` when
  `adrs/` is empty). `GET /api/adr/:id` returns the full record including `body`.
  `POST /api/adr` creates a `proposed` ADR that inherits `activeEpic`.
  `POST /api/adr/:id/accept` accepts only from `proposed`.
  `POST /api/adr/:id/supersede` writes a *new* ADR (`supersedes: old`) and marks the old
  one `superseded` — an accepted Decision is never rewritten in place.
  `GET /api/task/ADR-*` stays 400. AdrDrawer, lane `◇ N` chips, the task DECISIONS
  section, activity links on `ADR-*`, and palette jump targets (`Open ADR-0001 — title`).
- **`GET /api/epic/:id`** returns the full epic including `body` (BDM-65). `/api/board`
  stays body-stripped. `GET /api/task/EP-*` remains 400 — `requireTask` still owns the
  task surface, so later adr/capability detail routes copy this pattern instead of
  widening lifecycle routes.
- **Create, close and reopen an epic from the board** (BDM-66). `POST /api/epic`
  `{ title, body? }` creates and sets `activeEpic`; `{ id }` still activates. The
  drawer opens from a lane header (body, status/`closed`, children, plan chip,
  make-active, close/reopen). Task drawer `<Select>` refiles via the existing
  `PATCH { epic }` / `moveTask`. CreateModal lists open epics only.
- **CreateModal can start a task from a store template** (BDM-68). `GET /api/templates`
  lists `{ name, description }`; `GET /api/templates/:name` returns the file (`404` missing,
  `400` unsafe). `POST /api/task` with `template` runs the same `applyTemplate` merge as
  `tm task new --template` — unknown names are `400`, empty `acceptance` / `body` keep the
  template's, and `description` never lands on the task. The picker is hidden when the
  store has no templates.
- **The drawer tells the truth about type, body, epic and stop reasons** (BDM-67). Type is a
  real field (`types.ts`, create, toolbar filter, `POST /api/task/:id/type`), including types
  still worn only as a label. Context is inline-editable and a task can be refiled under another
  epic through the existing `PATCH`. Moving to blocked/parked takes a reason; starting work from
  the board stamps `actor`/`session`/`branch`/`worktree` the way `tm start` does. Drawer and bulk
  status lists include `backlog`.
- **Task drawer evidence, as attachments, not a CMS** (BDM-69). The EVIDENCE
  section lists each `evidence[]` string: `http(s)` URLs are links, `browser:` and
  other schemes are shown and never fetched. `GET /api/task/:id/evidence` returns
  derived `{kind,name,exists,previewable}` items with no new frontmatter.
  `GET /api/task/:id/file?ref=` is 200 only when the ref is on that task and the
  realpath sits inside `p.evidence`; traversal, other-task files, absolute paths
  outside the dir, and URLs are 404. Attach uses the same dest naming as
  `tm evidence` (`TM-NNN-<ts>.log` for text, `TM-NNN-<basename>` for a file) and
  `mutate` so two attaches cannot drop each other. Multipart is parsed in
  `bin/tm-dashboard` because the JSON body cap is 256 KB. Detach filters the
  array and leaves the file on disk.

### Changed
- **`tm epic use` / `tm_epic use` refuse a done epic** with the same reason the
  dashboard already returned as 409. **`tm epic done` / `tm_epic done` write `closed`**,
  matching auto-close and the drawer.

### Fixed
- **`acceptanceOf` writes `{ done: false }`**, not `{ met: false }` (BDM-73). Task
  gates and `tm done` read `a.done`; minted criteria were invisible to `gateDone`.
- AskUserQuestion capture inherits `activeEpic` and logs `decision_captured` on first write,
  `decision_updated` on a revision (BDM-70). `upsertDecision` returns `{ action }`, so
  `res.created` was always undefined and every first capture was logged as an update.
- Clearing priority no longer 400s — `null` is not a ladder value, so the drawer omits the field
  and the API treats omit/undefined as a clear.
- Clearing estimate removes the field instead of writing `0`.

### Build
- Dashboard bundle rebuilt after waves 1–4 (`index-BzSPLTgr.js`). plugin.json stays unpinned.

## [0.13.0] — 2026-08-18

### Changed
- **The store's git contract treats the audit log as per-machine** (BDM-61). `events.jsonl`
  and the rotated `events.*.jsonl` join `index.json`, `state.json`, `dashboard.*`, `port.assigned`,
  `.tm-tmp-*` and `state.lock*` in the `.gitignore` `tm init` writes. The markdown, `config.json`
  and `evidence/` stay the shared record. The log is still written on disk and still feeds
  standup / the dashboard; git just stops shipping one host's session stream to every clone.

### Added
- **Already-tracked host files are untracked on the next session.** SessionStart (and `tm init` /
  `tm doctor --fix`) run `git rm --cached` against any of those files git is still carrying, so a
  store that committed `events.jsonl` under the old contract drops it from the index on
  `/plugin update` without deleting the file. Being ignored never helped once git had the path.

## [0.12.1] — 2026-07-31

### Changed
- **Dependencies build into their own chunk, so a release stops rewriting 3.3 MB of git history.**
  The bundle is committed — that is what lets `/plugin install` work with no npm and no network —
  so the cost that matters is not first paint but how much of it git stores again each time. One
  character of app code used to rewrite the whole thing; the app chunk is now 78 kB and the vendor
  chunk is reused. Total on disk went down, 4.6 MB → 4.4 MB.
- `chunkSizeWarningLimit` is set deliberately rather than left to warn on every build. The default
  cannot be satisfied honestly — Atlaskit alone exceeds it, and chopping a design system into
  arbitrary pieces to quiet a linter would trade a real property (one cacheable vendor chunk) for a
  cosmetic one. The limit sits just above today's vendor chunk, so a jump past it is still news.

## [0.12.0] — 2026-07-31

The round that asked whether anybody else could install this, and found out by trying.

### Added
- **`bin/tm-hook`**, and `tm install` now puts it on PATH beside `tm` and `tm-dashboard` (TM-046).
  0.10.0 shipped `hooks/codex-hooks.example.json` telling readers to run `tm-hook` — a command that
  did not exist — and moved the capability matrix to ✅ on the strength of a payload test. Every
  test invoked `hooks/tm-hook.sh` by absolute path, so a fully green suite said nothing about the
  instruction. A Codex manifest holds a bare command string with no `${CLAUDE_PLUGIN_ROOT}` to
  substitute, so a resolvable name is the only thing it can carry.
- **`tests/test-install.sh`** — the install path run as a stranger: empty `HOME`, the plugin copied
  rather than symlinked, `env -i` so nothing from the developing session leaks in. It drives
  install → init → epic → task → dashboard, and checks the board identifies itself by *their* repo
  and records *them* as owner.
- An "Installing without Claude Code" section in the README, which is that path written down.

### Fixed
- **A hook attributed Codex's work to whoever launched Codex** (TM-046). A hook process inherits
  the environment of the shell that started the harness, so running `codex` from a Claude Code
  shell left `CLAUDE_CODE_SESSION_ID` set and every task Codex created was filed under the Claude
  session. The payload now wins over the environment — the harness naming its own session beats one
  inherited from someone else's, which is the rule `subagent-stop` already followed. Found by
  running Codex for real; the captured fixture could not show it.
- **The MCP handshake said `dev` to every client** (TM-047). An installed copy already answered with
  the SHA in its path; a source checkout now asks git, and lets it say `-dirty` — a client comparing
  two handshakes should see that the code moved even when the commit did not. `dev` was honest and
  useless, the mirror of the hardcoded `0.3.0` that 0.6.0 removed for lying.

## [0.11.1] — 2026-07-31

### Fixed
- The 0.11.0 fix for cross-kind links widened one map that four checks shared, so it quietly
  loosened three of them: `blockedBy: ["ADR-0002"]` and `parent: "ADR-0002"` stopped being reported.
  A task cannot be blocked by a decision record — nothing about an ADR can ever satisfy a
  dependency, so `tm next` would hold the task back forever without saying why.

  Two maps now, because there are two questions: dependencies and parents are between tasks; links
  cross kinds on purpose. Both directions have a test, since one map served both for a release and
  was wrong in each direction in turn.

## [0.11.0] — 2026-07-31

### Added
- **A board records who set it up** (TM-045, ADR-0002). `owner` is `git config user.name`/`user.email`
  for the store's directory, recorded at `tm init` and read-only for the same reason `boardId` is:
  it is derived, so writing it would change a file and change nothing else.

  It is deliberately *beside* the identity rather than being it. One person commits to every repo on
  a machine, so keying identity on them would make `bytedesk-persona` and `bytedesk-marketplace` the
  same board and re-open the leak TM-036 closed. `ADR-0002` records that reasoning, since it is the
  kind of decision a future reader would otherwise have to reverse-engineer from a guard.

### Fixed
- `tm doctor` no longer calls a link to an ADR dangling. `tm link <id> relates to ADR-0002` is
  accepted — `addLink` resolves any kind — while the audit looked at tasks alone. A store that
  accepts a link and then reports it as broken is worse than one that refuses it.
- **The work stream is now legible under Codex and Grok, not merely parsed** (TM-044). It was only
  ever *looked at* under Claude Code; opening it under the other two showed three problems at once.
  Codex's stream opened with its own injected preamble — the instruction file, the plugin catalogue,
  the environment block — thousands of characters before any work, burying the run inside it. Grok's
  tool calls rendered empty because its argument keys are `target_file`/`target_directory` and
  Codex's is `cmd`, none of which were in the allowlist. And every path was absolute and repeated.

  Preamble dropped, argument names covered across all three, paths shortened to the project root.
  Codex now reads as prompt → `exec_command` → result → answer; Grok as `WRITE` /
  `RUN_TERMINAL_COMMAND` / `SEARCH_REPLACE` with their targets.
- A single message can no longer push the rest of the stream off screen, and a transcript whose
  format has changed falls back to raw lines rather than an empty panel — which reads as *idle*
  when it means *broken*, the one lie this panel must not tell.

## [0.10.1] — 2026-07-31

### Fixed
- **The store's git contract now ignores its own lock files** (TM-043). Every per-machine file was
  listed except the two the lock itself creates. A process killed mid-write leaves `state.lock`
  behind, and one `git add -A` later every clone has a lock owned by a pid that never existed on
  that machine.

  Noise rather than deadlock — `staleLock` reads a foreign pid as dead, verified by committing a
  lock the way an older `tm` would, cloning, and writing to the clone — but noise in the one file
  whose whole job is making concurrent writes safe.

  Existing stores need no new mechanism: the 0.6.1 stale-contract check already tops up a contract
  that predates a rule, so `tm doctor --fix` adds both lines and keeps anything added by hand.

## [0.10.0] — 2026-07-31

### Added
- **Lifecycle hooks under Codex CLI** (TM-042). `hooks/codex-hooks.example.json` is the manifest to
  copy to `<repo>/.codex/hooks.json`; the shape matches Claude Code's, verified against a real one
  already on disk rather than inferred.
- `tests/fixtures/codex-pre-tool-use.json` — a Codex hook payload captured verbatim from a live
  `codex exec` turn by a hook that wrote its own stdin to a file. TM-039 deliberately left this
  unwired rather than guess the schema; this is the guess replaced with a capture, and the suite
  drives the fixture rather than a description of it.

### Fixed
- **Codex passes a hook no environment variables at all.** Its session arrives as `session_id` on
  the payload, so the hook adopts it (`TM_SESSION_ID`) before anything reads it — without that,
  every claim, gate and event under Codex attributed to nobody, silently. This also corrects a
  claim in 0.8.0: `CODEX_THREAD_ID` exists in the binary but is *not* in a hook's environment.

## [0.9.1] — 2026-07-31

### Changed
- **Board identity is derived from git on every read, not trusted from a file** (TM-041). TM-036
  stored it in `config.json`, which left the value that gates cross-board writes editable by anyone
  who could open the file it was defending — a guard you can talk out of is not a guard. The origin
  remote wins; the stored copy is only a record.
- `boardIdentity()` says where its answer came from: `git` is derived and authoritative, `config`
  is recorded for a project with no remote, and `directory` is an outright guess — two clones of a
  remote-less project in differently-named directories will disagree, and saying so beats
  presenting it as a fact.
- `tm config boardId` refuses while git supplies one, and exits 2. The dashboard could never write
  it — the settings allowlist already saw to that — and there is now a test saying so, because
  "not currently writable" and "cannot be written" are different guarantees.
- `tm doctor` reports `board-renamed` when the stored name no longer matches git, rather than the
  board quietly re-labelling itself.

### Fixed
- A repo that gains a remote, is renamed, or moves owner changes its derived identity under a store
  full of entities stamped with the old one — and the TM-036 write guard rejected all of them,
  making a rename brick the board. Both the current and the recorded name now count as this board's
  own. Found by the hooks suite, not by inspection.

## [0.9.0] — 2026-07-31

### Added
- **Motion on the board, carrying information rather than decorating it** (TM-040).
  - A card whose session is writing *right now* pulses. Driven by real writes off the SSE feed the
    board already holds — not by status, because `in_progress` is equally true of a card claimed
    four hours ago, and pulsing that one says nothing. It stops when the writes stop.
  - Cards fade in and out as they arrive, leave, or cross columns. This is the change nobody
    watching makes themselves: the board is multi-writer, so a card could move between glances with
    nothing to mark it.
  - Numbers that move say so — column counts, epic progress, acceptance tallies. Progress *grows*
    rather than teleporting, because progress is a direction.
- Built on `@atlaskit/motion`, already a dependency: its durations, curves and `FadeIn` /
  `ExitingPersistence` honour `prefers-reduced-motion` themselves, so there is no second switch to
  keep in sync with the one in `index.html`.

### Notes
Two rules are held by tests rather than by care: **nothing loops on an idle board**, and
**`prefers-reduced-motion` removes every animation without removing information** — everything
motion says here is also said by a column, a number or a timestamp.

Verified in a browser at 1600px: a quiet claimed card does not animate, the same card one second
after a write does, a status change runs the enter animation and finishes, and under reduced motion
nothing animates at all.

## [0.8.0] — 2026-07-31

### Added
- **The plugin runs under Codex CLI and Grok, not only Claude Code** (TM-039). Session identity
  reads whichever harness is present — `CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`,
  `GROK_SESSION_ID` — and *no* variable set now means no session, rather than a bare shell being
  quietly treated as Claude Code. `lib/harness/sessions.mjs` is the one module that knows the
  difference; nothing else grew a conditional.
- The dashboard work stream reads all three transcript formats and names which CLI it read from:
  Claude Code's `~/.claude/projects/<sanitized-cwd>/<session>.jsonl`, Codex's
  `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<thread>.jsonl`, and Grok's
  `~/.grok/sessions/<percent-encoded-cwd>/<id>/chat_history.jsonl`. Where there is no harness it
  says so, instead of rendering an empty panel forever.
- A capability matrix in the README, including the two things that do **not** work: Grok has no
  hook surface, and Codex's is real but not wired here yet (TM-042). What that costs you is stated
  rather than left to be discovered.

### Fixed
- `CODEX_SESSION_ID` was in the session fallback chain and exists nowhere in Codex — an invented
  variable reads as support and silently never matches. Every harness constant in this release was
  read off an installed CLI (`codex-cli 0.146.0`, `grok 0.2.117`) or a session file those tools had
  already written, and the tests assert that rather than the behaviour alone.

## [0.7.0] — 2026-07-30

### Added
- **Entities belong to a board, and a write that crosses repos is refused** (TM-036). The store is
  per-repo, but nothing checked that the thing being written belonged to the store being written
  to — and the two really do come apart: `tm` resolves its store from `CLAUDE_PROJECT_DIR` while a
  shell sits in whatever checkout it sits in. `bytedesk-persona`'s TM-001 held 25
  `bytedesk-marketplace` pull-request urls, filed by `gh pr create` run in one repo while the store
  resolved to another.

  A board is identified by its origin remote reduced to `owner/name`, so a clone is the same board
  and two siblings on one machine are not. `tm init` records it as `boardId` in the committed
  config; `create` stamps it on every entity; `write` refuses an entity from elsewhere and names
  the link that would express the relationship honestly. Entities written before this carry no
  board and are grandfathered — refusing them would break every existing store to catch a bug that
  has already happened.
- The PR-attaching hook compares the repo the ref came from against the board it is writing to, and
  records `git_link_skipped` instead of stapling one project's pull request to another's task.
- Cross-repo references: `tm link <id> relates-to owner/repo#TM-007`. One-sided by nature — the
  other store is not ours to write, and may not be on this machine.
- `tm doctor` reports `foreign-entity` for a stray already filed on the wrong board, and the
  dashboard does not render one.

### Fixed
- The event-catalog test scanned `lib/` flat, so it died with EISDIR once `lib/harness/` existed
  and silently ignored every event emitted there.

### Changed
- **Native-task mirroring is a multi-harness Bridge** (`lib/harness/`). Claude `TaskCreate` /
  `TaskUpdate`, Grok `todo_write`, and Codex `update_plan` are **Adapters** that only translate
  wire payloads into domain intents; one apply path mutates the store. A **Strategy** map
  selects the adapter by tool name. Pre-create gates (epic + WIP) and post-mirror behavior are
  shared. Hooks match all three harness tools (and Codex `apply_patch` on the edit path). Deny
  envelopes include Claude `permissionDecision` and Grok/Codex `decision` fields.
- **Codex packaging**: `.codex-mcp.json` registers `tm-mcp`; `.codex-plugin/plugin.json` declares
  `hooks` + `mcpServers` so Codex can load the same plugin root as Claude/Grok.

## [0.6.2] — 2026-07-30

### Fixed
- **Two processes could hold the store lock at once, and eight concurrent creates minted one id
  three times** (TM-015, reopened). Breaking a stale lock was `if (staleLock(lock)) unlink(lock)`
  — a verdict about a file, acted on after the file may already be someone else's. Traced under
  load: a holder releases, several waiters all read the now-empty path and all conclude "stale",
  and each in turn deletes the fresh lock the previous winner just created and takes its own.
  Four processes inside the critical section within two milliseconds.

  A lock that *vanished* is no longer "broken" at all — it is simply gone, and the atomic
  `open(…, "wx")` retry picks exactly one winner. A lock with a dead holder is now cleared under a
  second lock, so only one process breaks it and it re-reads the verdict while holding that
  exclusion. An orphaned breaker ages out, so a lock can never become permanently unbreakable.

  `tests/test-concurrency.sh` now asserts the *cause* rather than the symptom: it traces every
  acquire and release and fails if two processes are ever inside the lock together. Distinct ids
  were only ever the visible half — plenty of runs had overlapping holders and still looked fine.

### Changed
- `withLock` gained an env-gated lock trace (`TM_LOCK_TRACE`). A bug that only appears under
  contention cannot be reasoned about from the outside; this is how the above was found, and it is
  what the new assertion reads.

### Fixed
- **MCP handshake always includes `serverInfo.version`.** After commit-SHA versioning dropped
  `version` from the plugin manifest, `initialize` advertised `{ name: "task-management" }` with
  no version field. Claude Code still connected; Grok's strict client rejects that shape as
  `CustomResult` instead of `InitializeResult`, so every `tm_*` tool vanished for the session.
  The wire field is now always a non-empty string: manifest version when present, else the
  SHA-named install directory, else `"dev"`.

## [0.6.1] — 2026-07-30

### Fixed
- **`tm doctor` compares the store's git contract to the template, not just to nothing.** Seeding
  only ever wrote a *missing* file, so a store created before a rule existed never learned it, and
  the file's existence made doctor call the contract healthy. That is how every pre-0.5.0 store
  kept committing `port.assigned`, a per-machine file, while being told it was fine. A contract
  that exists is not a contract that is current.

  The repair appends the rules the store lacks under a header saying where they came from; it
  never rewrites the file, so anything added by hand survives. Reported as `stale-git-contract`,
  naming the missing rules. Applying it twice changes nothing the second time.
- A port test squatted the port `portFor()` derives and assumed it was free — passing on a quiet
  machine and failing on a busy one. It now lets the OS pick the squatter's port and makes *that*
  the standing assignment, which is the same behaviour with none of the chance.

## [0.6.0] — 2026-07-30

### Added
- **A live work stream beside the task drawer** (TM-035). Opening an in-progress task shows what
  the claiming session is actually doing — messages and tool calls — in the space between the
  drawer and the edge of the screen. `lib/transcript.mjs` joins the two halves the store already
  had: a claim knows its session, and Claude Code writes that session's conversation to
  `~/.claude/projects/<sanitized-cwd>/<session-id>.jsonl`. Served over SSE at
  `GET /api/task/:id/stream` as TanStack AI `UIMessage`s.

  Read-only by construction. The reader opens files and returns data; the panel renders and makes
  one `EventSource` GET. Watching a run is never a way to steer one.

  The transcript is read as a byte-range tail (a long session is 30+ MB), tolerates unknown event
  types and half-written lines, and drops `thinking` and `image` blocks — internal, and megabytes
  of base64 respectively. Rules in `.claude/rules/parsing-claude-jsonl.md`, including the
  sanitizer that replaces both `/` **and** `.`, which a worktree path needs.
- `Boundary.tsx` — a render error prints on the page instead of unmounting the tree. A React throw
  painted an empty board and said nothing, which in a browser with no devtools open is
  indistinguishable from a dead server.

### Build
- `@tanstack/ai-react` for the message model. Note it ships hooks and stream adapters, not chat
  components, and its hooks are built around *sending* — so the library contributes `UIMessage` /
  `MessagePart`, which the server now speaks, and the rendering stays Atlaskit like every other
  surface here.

## [0.5.0] — 2026-07-30

The release that made the board readable at a glance and the store portable.

Two of these are silent failures rather than features, and they are the reason to upgrade: a
store the repo quietly ignored never reached a second clone, and a clone that did arrive
refused the first task it was asked to create. Both looked healthy from the inside.

### Added
- **Backlog and ToDo columns** (TM-034). A `backlog` status, wired end to end: `tm defer <id>`
  moves work out of the queue, `tm todo <id>` brings it back. Backlog sits outside `store.OPEN`,
  so deferred work stops competing for attention in `tm next` without being closed. Column
  order and display names now live in one `COLUMNS`/`LABEL` pair in `lib/render.mjs` that
  `tm board`, `tm sprint` and the SPA all read — the terminal and the browser cannot disagree.
  `open` renders as "todo" everywhere a human reads it: same status, honest name.
- **Collapsible epic lanes** (TM-038), folded state kept per project in localStorage. One
  browser has tabs open on several boards, so a single key would fold the wrong lane. A folded
  lane keeps its header and progress bar — that is the reason to fold it, not lose it.
- `tm init` and `tm doctor` report a store the repo would keep out of git — an ancestor
  `.gitignore` swallowing `.bytedesk/`, named down to the `<file>:<line>:<pattern>` to edit
  (`store-ignored`, an error, in doctor; a warning on stderr at init).

### Fixed
- **A fresh clone now runs as the committer's checkout did.** `activeEpic` lived in the
  gitignored `state.json`, so it never travelled: the clone rendered a correct-looking board
  and then refused the next `tm task new` for having no active epic. It moves to the committed
  `config.json`; claims, overrides and the last Stop block stay per-machine. Existing stores
  read through transparently and migrate on the next write.
- **The dashboard keeps its port across a restart** (TM-037). `portFor()` derives a
  deterministic port from the store path, so only a port that *drifted* off it — because
  something else held it at first launch — depends on stored state. That assignment lived in
  `dashboard.assigned-port` and was swept by anything clearing `dashboard.*`, which moved the
  URL of a running board. It is now `port.assigned`, outside that glob, and a pre-0.5
  assignment is adopted and migrated on first use.
- The MCP handshake advertised a literal `0.3.0` after the manifest dropped its version; it
  reads the manifest now, or reports no version at all, which is the honest answer under
  commit-SHA versioning.

### Changed
- The store guard covers an *installed* copy of the plugin (`~/.claude/plugins`, which
  `/plugin update` overwrites) rather than whatever git repo the plugin's source sits in. A
  source checkout is an ordinary project: the marketplace repo tracks its own work with no
  `TM_ROOT` and no repo-local config. The old git-based test also mis-fired when the installed
  tree sat inside a dotfiles repo, claiming the whole home directory as the plugin's repo.
- Keyboard digits follow the columns: `1` is backlog, `6` is done. Six columns, six digits.
- `tm sprint` headings read `in progress` rather than `in_progress`, from the shared labels.

### Notes for existing stores
A store created before this release does not carry the `port.assigned` rule. `tm doctor --fix`
adds it (see 0.6.1) — nothing to do by hand.

## 0.4.0

The release that made the store trustworthy under parallel work, and gave it a layer above
tasks for deciding what to build.

Two of the fixes below are the reason to upgrade rather than the features. `writeAtomic`
staged into files ending in `.md`, so the store read its own half-written staging files as
entities and a concurrent create could lose its write; and a waiter that timed out broke a
lock a live process was still holding. Both only appear under parallel sessions, which is
exactly what this plugin is for.

Added: capabilities (`CAP-*`) and the `/enhance` loop, sprints, `tm find field:value`,
`tm edit`/`tm move`/`tm type`/`tm reopen`, goal import, a git contract written by `tm init`,
per-repo board preferences with a settings menu, and a subagent brief so a spawned agent
knows what the session is already doing. The board now names the project it belongs to
instead of calling itself `task-management` on every repo.

Removed: `tm export pm`.

Also: `monitors` moved under `experimental.monitors` in the manifest, which is where
`claude plugin validate` now wants it — top-level still loads but is slated for removal.

### Added

- **Capabilities: the discovery layer above tasks, and `/enhance` to drive it.**

  This started as `docs/capabilities/` in one product repo — a YAML registry, one markdown card
  per capability, a `next_id` counter, and a python script whose entire job was checking that the
  registry and the cards still agreed. Every one of those pieces is something the store already
  does for epics, tasks and ADRs. So a capability is now a fourth kind (`CAP-*`) and all of it
  goes away: ids, status, evidence, search, events, `tm find`, `tm doctor` and the MCP surface
  come for free, and there is no index to hand-edit or validate.

  `tm cap new` proposes, `tm cap list` ranks by impact × ease × confidence (1–27, small enough to
  check by eye), `tm cap accept` mints the task that builds it and carries the card's acceptance
  criteria across as that task's gate, `tm cap ship` refuses without evidence. The task links back
  to the capability, so the reason for the work outlives the session that proposed it.

  Impact and confidence stay H/M/L and effort stays S/M/L, deliberately — one uniform scale would
  have silently reinterpreted `impact: L` from *low* to *large* on every imported card.

  Skills: `enhance` (the loop), `enhance-capture`, `enhance-research`, `enhance-propose`,
  `enhance-track`. The old suite's sixth skill, `enhance-refresh`, is folded into `enhance-track`
  — both were "mark it shipped, with evidence".

  `scripts/import-capability-cards.mjs` reads a legacy `docs/capabilities/` store once, preserving
  ids so existing references still resolve. It is idempotent and has a `--dry-run`.

  Also, because it was the same omission: `tm show` on a dropped capability now prints why it was
  dropped. It already did this for `blocked` and `parked` and the third case was simply never added.

  Not done: the dashboard has no capabilities panel yet — `tm cap list` and `tm find` are the
  read paths for now.

### Removed
- **`tm export pm`.** The format emitted `pm_issue_create` payloads for the
  `project-management` plugin, which has been removed from this marketplace — so it was
  exporting to a destination that no longer exists here. `md`, `csv` and `json` are unchanged,
  and an unknown format is still refused rather than silently substituted. This also retires the
  README's long-standing note delegating sprints to that plugin, which means sprints are now a
  legitimate candidate for this one: `burndown()` still has no denominator and `estimate()`
  still has no consumer.

### Added

- **Sprints, which is what gives `estimate` a reader.** Points were writable from the CLI, the
  dashboard and MCP, and consumed by nothing — the same write-only shape `priority` and `rank` had.
  `burndown` counts *cards*, so a two-point card and a thirteen-point card moved the line by the
  same amount. A sprint supplies the denominator: this much committed, this much done.

  ```
  tm sprint new "Sprint 12" --ends 2026-08-14
  tm sprint add TM-001 TM-002
  tm sprint
    3/16 points done across 4 card(s), 1 unsized
  ```

  A sprint is its own kind — `sprints/SP-001-….md`, an id, a status, a body — because everything one
  needs the store already does for epics and ADRs, and a parallel mechanism would be a second way to
  say what it already says once. It is **not** a second epic: an epic says what a body of work *is*,
  a sprint says what you committed to finishing this fortnight, and a task carries one of each.

  Cards with no estimate are counted apart rather than as zero. "12 of 20 points done, and four
  cards nobody sized" is true; folding the unsized into zero reports the sprint as further along
  than it is.

  Closing a sprint does not touch unfinished work — it is simply no longer committed, and the close
  says how much is left. `tm find sprint:SP-001` lists what it holds.

  This was parked because the README delegated sprints to the `project-management` plugin by name.
  Removing that plugin removed the objection, and the note left on the task at the time —
  "`burndown()` still has no denominator and `estimate()` still has no consumer" — turned out to be
  the whole specification.

- **`/goal` is captured onto the work in flight, and goals are reachable as a resource.**

  I had parked this after reading Claude Code's own source: `/goal` is a *local, immediate* command,
  and local immediate commands are handled client-side without a prompt round trip — so capturing it
  looked impossible and I recorded that rather than guess. **That was wrong.** With a probe hook
  installed, typing `/goal …` produced a `UserPromptSubmit` payload whose `prompt` field held the
  literal text. Measured beats inferred, and the parked note was the thing that turned out to be a
  guess.

  What lands is a note on the **claimed** work, not a new task. A goal is a condition on the work in
  flight — "keep going until X" — and minting a task for it would put a second entry on the board
  for something already tracked, which is the exact duplication the rest of that hook exists to
  prevent. With nothing claimed it stays silent rather than inventing an owner, and `/goal clear` is
  not a goal.

  `tm://goals` lists every task imported from a goal doc with its still-unmet success criteria —
  a goal's acceptance criteria *are* the doc's criteria, so this answers "is it met" without having
  to remember which id it was. `tm find goal:<doc>` finds them too.

  **The Stop-hook collision is handled rather than left.** `/goal` registers its own Stop hook, so
  two things can refuse one stop. They do not disagree — a goal says "keep going until X", the gate
  says "do not leave work in_progress" — but two separate refusals read as the tool nagging twice.
  When a goal is recorded against the claimed work, the gate names it, so the two arrive as one
  story.

  `tm show` also prints comments now. It was the one first-class field it did not, though it prints
  labels, links, evidence and commits — so the detail view was missing the discussion about the
  thing it was detailing.

- **The board names the project it belongs to.** Every board called itself `task-management` — the
  plugin's name, identical on all of them, which tells you nothing about which one you are looking
  at. With two open, the header *and* the browser tab were the same on both, and the only way to
  tell them apart was the port in the URL.

  The repo's directory name in title case, so `bytedesk-persona` reads **Bytedesk Persona**. It
  needs no configuration, it is what a person calls the project, and it is already what the store is
  scoped to. The tab title is set from the payload rather than at build time, because one built
  bundle serves every project.

  A word that is already mixed case is left as written: `myApp` stays `myApp` rather than becoming
  `Myapp`, which would be a worse name than the one its author chose.

- **The store now has a git contract, written by `tm init` and audited by `tm doctor`.**
  `.bytedesk/task-management/` is meant to be committed — one markdown file per entity is what makes
  a board readable in a diff. But four kinds of file in there are not the project's business, and
  with no rule they sat in `git status` forever and were one `git add -A` away from being committed
  and conflicting on every pull: `index.json` (a derived cache the README already calls disposable),
  `state.json` (session claims and overrides — whose machine, not what work), `dashboard.*` (a port
  and a pid for a server running here, now) and `.tm-tmp-*` (the staging files `writeAtomic` renames
  over the real ones).

  `events.jsonl` gets `merge=union`, and that is the piece worth having. It is append-only, so two
  branches that both did work produce two sets of added lines at the end of one file — a textbook
  conflict that is never a real one, on the file least interesting to resolve by hand.

  Seeding never overwrites: `tm init` is how an older board is adopted, so it writes only what is
  missing and leaves hand-edited rules alone. `doctor` reports a store without a contract and can
  write one, and separately warns when a per-machine file is **already tracked** — being ignored is
  no help once git is carrying it, so that finding names the `git rm --cached` to run rather than
  pretending it can fix it.

- **Board preferences live in the repo, and there is a settings menu to reach them.** They had
  nowhere to live: the notification switch was a bare button in the status bar, the group-by-epic
  toggle was loose in the toolbar, and the rest was in `localStorage` with no surface at all. So a
  preference was invisible until you found the control that owned it — and it applied to one browser
  on one machine, which is why notifications had to be switched on again everywhere.

  The preference was never about the browser; it was about the project. `POST /api/settings` writes
  to the store's own config file next to the tasks, and the board payload carries it back, so any
  browser opening that repo starts with the answer already given.

  `localStorage` stays as a cache in front of it: this is an installable app with an offline outbox,
  reading synchronously at mount avoids a flash of the wrong settings, and a board that cannot reach
  its server still knows what you asked for. The store wins the moment it answers.

  Writable keys are an **allowlist**, not just a namespace. The rest of the config holds the gates —
  `enforce`, `wipLimit`, `requireAcceptance` — and a browser tab is not the place to switch off
  rules the CLI and the hooks are enforcing; `tm config` still owns those. An unknown key is named
  back in the response rather than silently accumulating in a file people read.

  Two menus rather than one: a profile menu for "who does this board think I am" — which nothing
  displayed before, though `me` is what decides whether a change counts as *your* work — and a
  settings modal for how the board behaves. `installDismissed` is deliberately not shared; whether
  this browser dismissed an install banner is genuinely about this browser.

  The notification **permission** is a browser grant the page cannot store on anyone's behalf, so
  the modal says so and offers to ask, rather than showing switches that cannot fire.

  Built on `@atlaskit/dropdown-menu`, `@atlaskit/toggle` and `@atlaskit/modal-dialog` — Atlaskit is
  the base component library here, so the rule is to reach for it before writing anything.

- **A spawned agent is told what the session is already working on.** `SessionStart` fires once per
  session; a subagent spawned mid-session got none of it, so it began knowing nothing about the
  board — not which task its parent was holding, not what "done" meant for it — and could file a
  duplicate for work already tracked. The plugin now answers `SubagentStart`:

  ```
  ## task-management — what this session is already working on

  The parent session holds TM-018 "credential configuration through the UI" (EP-001).
  Not yet met:
  - [ ] the operator can set a provider key without editing a file

  The parent holds the claim, so do not run `tm start`, `tm done`, `tm park` or `tm block` on these —
  report what you found and let the parent record the outcome. Reads (`tm show`, `tm board`, `tm find`)
  and additive notes (`tm comment`, `tm evidence`) are fine.
  ```

  Both halves of the hook contract were established by **spawning a real agent against a probe
  hook** rather than inferred from the payload schema: the agent quoted back a marker token that
  appeared nowhere in its prompt, and the captured payload confirmed `session_id` is the parent's —
  the same key the claims are held under, so the lookup is the one `subagent-stop` already uses to
  attribute the work afterwards.

  Deliberately **not** `handoff()`. That is a cold-start dossier — epic body, evidence, commits,
  branch, worktree — and it ends with `Resume with: tm start <id>`, which is precisely wrong advice
  for an agent whose parent already holds the claim. What a subagent lacks is orientation and a
  guardrail, and both are short.

  Nothing claimed produces **no output at all**, not an empty envelope: this is prepended to every
  agent in a fan-out. Capped at 3 tasks, 5 unmet criteria each and 1200 characters, and it says how
  many it left out rather than truncating silently. Criteria already met are dropped — the useful
  half of "done" is the part still outstanding.

  It opens with its own heading because the live spawn showed every `SubagentStart` hook's
  `additionalContext` arriving concatenated into one block, directly after another plugin's
  instructions.

- **A subagent is briefed on the work it was spawned into.** `SessionStart` fires once per session,
  not per agent, so a spawned subagent started knowing nothing about the board — not that one
  existed, not which task its parent held, not what "done" meant for it. It re-derived context the
  parent already had, or filed a duplicate for work already tracked.

  The plugin now answers `SubagentStart` with the parent's claimed work:

  ```
  ## task-management — what this session is already working on

  The parent session holds TM-001 "wire the vendor SDK" (EP-001).
  Not yet met:
  - [ ] the token refresh path is covered by a test

  The parent holds the claim, so do not run `tm start`, `tm done`, `tm park` or `tm block` on these —
  report what you found and let the parent record the outcome. Reads (`tm show`, `tm board`, `tm find`)
  and additive notes (`tm comment`, `tm evidence`) are fine.
  ```

  Both halves of the contract were established by **spawning a real agent against a probe hook**
  rather than inferred from the payload schema: `SubagentStart` carries the *parent's* `session_id`
  — which is exactly the key claims are held under — and whatever the hook returns as
  `additionalContext` reaches the agent, prefixed `SubagentStart hook additional context:`. The
  agent quoted back a token that appeared nowhere in its prompt.

  Only the unticked criteria, because a met one is settled and the job is what is left. Nothing at
  all when the parent holds nothing, since a brief injected into every fan-out regardless is a tax
  every agent pays for the case where it happens to matter. Bounded at 3 tasks, 5 criteria each and
  1200 characters, and it reports how many claims it left out rather than truncating in silence.

  It is deliberately not `handoff()`: that is a cold-start dossier — epic body, evidence, commits,
  branch, worktree — for someone picking a task up with nothing in hand, and it ends with
  `Resume with: tm start <id>`, which is exactly wrong here. The parent already holds the claim, and
  now that the interlock actually engages, an agent following that advice would burn its turn on a
  refusal it cannot resolve. That is also why the brief names the lifecycle verbs as off limits
  while pointing at `tm comment` and `tm evidence`, which are additive and safe from a subagent.

  The brief opens with its own heading because every `SubagentStart` hook's `additionalContext` is
  concatenated into one block under a single prefix — observed in the live spawn, where this text
  landed directly after another plugin's instructions.

- **`tm find` takes `field:value`: the terminal and the agent can ask what only the browser could.**
  The board in the browser has always filtered by epic, assignee, actor, priority and label, and
  saved the combination as a named view. `tm find` was a substring match over titles and bodies — so
  "what is assigned to me and still open" was answerable on exactly one of the three surfaces, and
  it was the surface an agent cannot use.

  ```
  tm find status:in_progress priority:highest
  tm find assignee:ryan -label:stale
  tm find epic:EP-002 type:bug "the half-remembered title"
  tm find -assignee:                     # the unassigned queue
  ```

  Fields: `status`, `epic`, `assignee`, `actor`, `priority`, `type`, `label`, `kind`, `id`. Bare
  words keep meaning exactly what they meant. Every filter ANDs, including a repeated key —
  `label:ui label:perf` is "has both", and OR is running the search twice. `tm_find` takes the same
  query as one string, so an agent asks the board a question rather than reading the whole board and
  filtering it itself.

  Deliberately **not JQL**. No operators, no precedence, no parentheses, no ORDER BY — this is the
  `key:value` syntax `gh search` and GitHub's search box already use, because a query language needs
  a parser, an error surface and a manual of its own, and none of that buys an answer you could not
  already get.

  An unrecognised field is **refused** with the list of real ones. `assigne:ryan` quietly returning
  every task whose body contains that string is a wrong answer that looks like a right one — the
  same reason `tm priority` refuses an unknown level rather than substituting a default. A token
  whose value starts `//` stays a search term, so `tm find https://…/pull/73` does not parse as a
  filter on the field `https`.

  The browser keeps its own implementation in `dashboard/src/filters.ts`, which also drives the
  dropdowns and the saved views; the SPA imports nothing from `lib/`. So a test reads the `Filters`
  interface out of that file at test time and asserts the CLI covers every field it names — removing
  one field from either side turns it red. Same technique as the ntfy catalog test, which has caught
  a missing event twice.

  `tm find` renders hits with the same line the board uses, so a filtered result shows status,
  priority and blockers instead of just an id and a title. That put ADRs through `taskLine` for the
  first time and they came out as `? ADR-0001`, so `proposed` now has a mark of its own (`◇`) — a
  decision nobody has ratified yet, rather than a broken row.

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

- **The store read its own staging files, and a create could lose its write.** `writeAtomic` stages
  at `.tm-tmp-<pid>-<name>` — built from the target's basename, so it **ends in `.md`**. Every reader
  globbed `.endsWith(".md")`, so one process saw another's staging file in `readdirSync`, the rename
  moved it, and the `readFileSync` that followed opened a path that no longer existed:

  ```
  tm task: ENOENT: no such file or directory, open '…/tasks/.tm-tmp-3705640-TM-003-….md'
  ```

  That is the create that never wrote a file: eight concurrent creates producing seven files, seven
  ids and seven index rows. It needed a second process writing at the instant a first was listing,
  which is why it only ever appeared with several suites running at once and never on its own.

  The comment above `writeAtomic` claimed the leading dot meant it "never matches". The dot was
  never consulted — the filter asked about the extension. It is consulted now, and `list` also skips
  a name it cannot open rather than failing the whole read: the caller asked what is on the board,
  and something that stopped existing is not on it.

  Reproduced at fourteen parallel copies of the concurrency suite, where it failed in two rounds of
  three; **42 of 42 clean** at that same load afterwards, plus two deterministic assertions that
  fail against the previous behaviour.

  `test-concurrency.sh` no longer sends the creates' stderr to `/dev/null`. It reported
  "expected 8, got 7" and threw away the one line that said why, which is the reason this took so
  long to find.

- **A waiter that timed out broke a lock a live process was holding.** `withLock` read
  `if (staleLock(lock) || Date.now() > deadline)`, so a process that had queued for the deadline
  deleted the lock and walked in — overriding the answer `staleLock` had just given, which was that
  the holder is alive and working. Both then held it, and a read-modify-write of `index.json` lost
  one side.

  The window needs a queue to open, which is why it only ever appeared under load: waiter W starts
  at T; a *different* process takes the lock legitimately at T+25s; at T+30s W's own deadline passes
  while that holder's lock is five seconds old and its pid alive. W broke it anyway.

  Reproduced by running six copies of the concurrency suite at once — two failed on "index.json
  carries every concurrently created task" while every file was present, which is the exact shape of
  a lost index write.

  Timing out is now a refusal the caller can see and retry. Thirty seconds for a lock held for
  milliseconds means something is genuinely wrong, and a visible failure beats a store that quietly
  disagrees with itself. A lock whose holder is actually gone is still cleared, which is the only
  reason to break one.

  `TM_LOCK_TIMEOUT_MS` overrides the wait. The right value depends on the filesystem — a network
  mount can make a microsecond write take a very long time — and it lets a test prove the refusal
  without waiting half a minute.

- **Saved views followed the browser, not the board.** A view is a way of looking at *this* project,
  and it was kept in `localStorage` where the project could not reach it — save one on your laptop
  and it did not exist on your desktop, or for anyone else on the same repo.

  They go to the repo's config now, through the `views` key the settings allowlist was already
  holding open. `localStorage` stays as the cache that renders instantly and survives offline; the
  repo's copy wins on any name defined in both, since a local copy of a shared name is a stale echo
  of an earlier save. Names only one browser knows are kept rather than dropped, so a view saved
  while the server was unreachable is not lost.

  The note in `filters.ts` used to read "move to the store only if views need to follow the project
  across machines". They did.

- **Comments were an undifferentiated wall.** Each was a single `Text` holding author, timestamp and
  body run together — `main · 2026-07-29 23:37 — …` — so nine comments became a solid block whose
  only boundary marker was spotting `main ·` at the start of a line. The metadata shouted exactly as
  loudly as the thing it labelled.

  One entry per comment now: attribution above the body in subtlest text, a rule between entries,
  and an explicit "No comments yet" instead of a section that renders as nothing.

- **The card title was not a control.** It was a `Box` — a plain `div` — with `cursor: pointer` and
  an onClick. It looked clickable and was clickable with a mouse, and that was the whole of it:
  `Tab` never reached it, screen readers never announced it, and automation could not find it.

  That last one is how it surfaced. Driving the board with agent-browser, the title could not be
  clicked at all — there was no interactive element there to click, so the tool reported no match
  where a person sees an obvious link. The board's `j`/`o` keys were a workaround you had to know
  existed.

  `Pressable` from `@atlaskit/primitives` — a real `button` underneath, with padding and background
  reset so it still reads as a title — plus an `aria-label` naming the task it opens. The title now
  appears in the accessibility tree, takes keyboard focus, and opens on Enter or Space for free.
  Pinned by two assertions in `tests/browser/drawer.mjs`.

- **`subagent_stop` logged where the transcript was filed, not what the agent said.** A path is a
  file nobody opens: reading it means leaving the board, finding a JSONL of the whole conversation
  and reconstructing the ending. Claude Code puts the agent's closing message on the payload as
  `last_assistant_message` — confirmed by capturing a real SubagentStop — so the timeline says what
  came back:

  ```
  before  A subagent finishes — a1  Explore  TM-001  /tmp/agent-a1.jsonl
  after   A subagent finishes — a1  Explore  TM-001  Found 3 callers of resolve() in useBoardKeys.ts
  ```

  Headings, fences and bare bullets are skipped in favour of the first line of prose, because
  `## Result` is a label rather than a finding and tells you nothing the event kind did not. Inline
  emphasis is stripped — `**three** callers` reads worse than `three callers` in a line with no
  bold — and the whole thing is clamped to 240 characters, since it renders in `tm log`, the
  activity panel and a push notification. The transcript path stays, for when the summary is not
  enough.

- **`dashboard/node_modules` was a committed symlink to an absolute path, pointing at itself.**
  `.gitignore` said `node_modules/` — with a trailing slash, which matches a directory and **not a
  symlink** — so the link went in, carrying one developer's home directory into a shared repo. On
  that machine it happened to resolve. Anywhere else it dangles.

  What it cost was silent, which is why it survived: `npm run build` ran `tsc` (which passed), then
  `vite`, which could not resolve through the loop and did nothing at all, and the script still
  exited **0**. `dist/` simply stopped changing while every source edit looked applied. I shipped a
  rebuild believing it had run and only caught it because the bundle hash had not moved.

  Untracked, and the ignore rule loses its trailing slash so it matches a directory *and* a symlink.
  A clean checkout now installs 685 packages and builds.

  Guarded by `tests/unit/repo-hygiene.test.mjs`, which asserts the two halves of the defect: nothing
  npm installs is tracked, and no committed symlink names an absolute path — a path on one machine
  cannot be right anywhere else, and when it points inside the repo it can point at itself. Both
  assertions fail against the previous commit and pass now.

- **The drawer's text inputs read as text and become fields when clicked — and the title was
  unreadable before.** It was a permanently-open single-line `Textfield` beside a Rename button, so
  the panel's most important content was a form control. On a long title the browser scrolled that
  input to its END: 605px of text in a 467px box, leaving the header showing
  `ntity, captured from /goal the way plans are captured from ExitPlanMode`. You could not read
  which task you had open.

  `@atlaskit/inline-edit` for the title, assignee and estimate, `@atlaskit/icon` for the remove
  glyph, and `IconButton` for the control that carried it. Atlaskit is the base component library
  here, so the rule is to reach for it before writing anything.

  Twelve controls in this drawer had no label, no `aria-label` and no accessible name — four used a
  placeholder as a label, which vanishes the moment you type. The three converted fields now carry
  a real `label` and an `editButtonLabel`, and the remove control announces itself as
  `Remove acceptance criterion 3` instead of being a bare `✕` character.

  **Escape belonged to two components at once.** `Drawer` closes on it and `InlineEdit` cancels on
  it, and the drawer won — click a title, type, press Escape to back out, and the whole panel went.
  Three fixes did not work, each found by trying rather than reasoning: a React `onKeyDown` with
  `stopPropagation` (React delegates from the root, so it never reaches a native document listener);
  reading `document.activeElement` in `onClose` (InlineEdit has already moved focus back to its
  read-view button); and counting open fields (`onCancel` zeroes the count before `onClose` asks).
  What works is a capture-phase listener on `document` while a field is open, which was measured to
  stop the close outright — and since swallowing the key also denies InlineEdit its own handler, the
  cancel is performed explicitly. `isEditing` is controlled, so returning to the read view without
  confirming *is* the cancel.

  Escape with no field open still closes the drawer, which was briefly regressed by an `onClose`
  guard that became redundant once the capture listener worked. Both paths are verified in a
  browser.

- **The task drawer had no scroll of its own, so a third of a dense task was unreachable.** It was a
  single `Stack` inside a fixed-height panel, and its content simply overflowed. Measured on a task
  with five acceptance criteria at an 812px viewport:

  ```
  panel clientHeight   812
  content scrollHeight 1022     → 210px unreachable
  scrollable elements inside the panel: 0
  ```

  The whole COMMENTS section — every comment and the field to add one — sat below the fold with no
  way to get to it. And because nothing inside the panel scrolled, a wheel over the drawer scrolled
  **the board behind it**, which is how it was reported.

  The drawer is a grid now: `auto 1fr`, header in row one, body in row two owning the overflow.
  `minHeight: 0` on both rows is the load-bearing part — a grid item defaults to `min-height: auto`,
  refuses to shrink below its content, and an item that cannot shrink cannot overflow, so without it
  the body pushes the panel open again and the bug returns wearing a different shape.
  `overscroll-behavior: contain` on the body is what stops a scroll that reaches the end from
  chaining to the board underneath.

  The identity — id, status, actor, epic and the title field — moved **out** of the scrolling region.
  On a long task, scrolling back to remember which one you are looking at is a tax on every read.

  The body is grouped into sections separated by a rule instead of ten control groups in one
  undifferentiated column with two all-caps `Text` blobs doing the work of headings. One `Section`
  component now, so every group is separated the same way.

  Guarded by `tests/browser/drawer.mjs` — raw CDP against headless Chrome at a deliberately short
  viewport, the same approach `tests/browser/keyboard.mjs` takes, because none of this is expressible
  against jsdom: it is computed style, real layout and real overflow. It opens the card through the
  board's own `j`/`o` keys rather than guessing at a clickable element, and it reports rather than
  passing silently when nothing overflows. Checked against the pre-fix layout: 4 of its assertions
  fail there, 7 of 7 pass now.

- **Acceptance criteria were a one-way door.** Three surfaces could tick one and none could untick
  it; the dashboard's checkbox set `isDisabled` the moment it was checked, locking the box it had
  just ticked. Nothing anywhere could remove a criterion added by mistake. Since `tm done` is gated
  on the list, a stray click or a typo permanently changed what the tool would accept — and the only
  way back was editing the frontmatter JSON by hand.

  Reported by a user who ticked one on the board and could not untick it. I had filed the missing
  *remove* an hour earlier after hitting it myself; the missing *untick* is the sharper half and I
  had not noticed it.

  ```
  tm accept <id> <n>            tick
  tm accept <id> <n> --undo     put a mis-tick back
  tm ac <id> --rm <n>           remove one that should never have been there
  ```

  All three surfaces: the board's checkbox toggles and each criterion gets a ✕; over MCP it is one
  tool, `tm_ac_accept` with `undo` or `remove`. The HTTP action stayed `accept` with a flag rather
  than gaining a second route, partly because the route matcher is `[a-z]+` and admits no underscore,
  and mostly because that is the shape the MCP tool already takes — one verb, three intents,
  described identically on both surfaces.

  Unticking **does not reopen a done task**. That is a decision rather than an invariant: the work may
  genuinely be finished and the criterion merely mis-ticked, and `tm doctor` already reports exactly
  this as `done-unmet` and refuses to auto-repair it for the same reason. The CLI says so in its
  output instead of acting on your behalf. Unticking also drops the met-at timestamp — a met-at on
  something unmet reads as history and would survive into `tm export`.

  Removing **renumbers what follows**, so every surface returns the surviving list: "AC 4" in an older
  commit message now points at a different sentence.

  Verified through the rendered UI, not just the API — tick, confirm the box is still enabled,
  untick, remove — then checked against the store and the timeline.

- **`tm standup` printed a machine trace, and the dashboard's activity panel printed raw event
  keys.** The store's event log had a human rendering — `tm log` gained one — and the two places you
  actually read history did not use it.

  ```
  $ tm standup                                     # before
  - TM-001 the task — create → update → claim → update → update → update → release → done
  ```

  Three of those eight tokens are the word `update`, and none says what moved. A standup answers
  what got finished, what is being worked on and what is stuck, so it is those sections now, and the
  per-task line is the **status path** with the stop reason on anything stuck:

  ```
  ## Finished (1)
  - TM-001 the finished one — in_progress → done (1 AC met)
  ## In progress (1)
  - TM-002 the one in flight — in_progress
  ## Stuck (1)
  - TM-003 the stuck one — blocked — waiting on the security review
  ## Also touched (1)
  - TM-005 just commented on — A task, epic or ADR is created, A comment is added
  ```

  Work that moved no status still gets a line, summarised by what did happen — a day of comments and
  commits is real work and dropping it would make the report lie by omission.

  The activity panel showed `02:01:02  main  update  TM-003`, three rows running, which says a field
  changed on three tasks and nothing about which field or what it became. The payload was carrying
  the answer all along: `update` holds `patch` and `status`, `moved` holds `from`/`to`, `park` and
  `block` hold `reason`. It reads them now, and takes the sentence for the event kind from the
  store's own catalog via `/api/events` rather than keeping a second vocabulary in TypeScript — so
  the panel and `tm log` describe the same event the same way.

- **Two bugs in `collapseLog`, both found by making the standup use it.**

  Its status tracker was **one shared variable**, so any entity's status change masked another's:
  with a task going `in_progress → done` and its epic auto-closing in the same window, the task's
  `done` left the tracker reading "done", so the epic's own move to done counted as no move and was
  dropped. The epic closed and the log said nothing. Keyed per entity now — interleaved work on one
  board is the normal case, not the exotic one.

  And **arriving at `open` counted as a transition.** Every `update` event carries the doc's status
  whether or not the write changed it, and a `create` records none, so the first update after a
  create always looked like a move into `open`: every task carried a `→ open` row saying nothing had
  happened yet. A transition now requires the write to have actually touched status, read off the
  `patch` field the event already records — so the intent is taken from the event rather than
  guessed from the value, and deliberately reopening a task still reads as a transition.

  `collapseLog` also grew a `keep` option that marks rather than drops. The dashboard serves one
  events array to the activity panel *and* to burndown, `startTimes` and the PWA's notification
  matcher — and that matcher switches on `event.event`, so rewriting an `update` there would have
  silently changed which notifications fire. One judgement, expressed two ways, with a test that
  asserts the two agree.

  `renderLog` now collapses too. Only `renderHistory` did, so `tm log <id>` was clean while
  `tm log` — the view you actually reach for — still printed the generic `update` immediately above
  the specific event explaining it.

- **A stopped card never said why it stopped, on either surface.** `tm park <id> <why>` and
  `tm block <id> <why>` have always stored the sentence you typed. It was read by `tm why <id>`
  (one task at a time), `tm export md`, and a PWA notification — and by neither board:

  ```
  $ tm park TM-001 waiting on the vendor SDK license
  $ tm board
  ## parked (1)
  ⏸ TM-001 vendor integration [EP-001]          ← you typed a sentence; the tool swallowed it
  ```

  So "what is everything stuck on" was one command per task, and `tm show` on a blocked task
  printed its status and not one word about what it was waiting for. `renderShow` already printed
  `reopenedReason`, so the shape existed for one of the three reasons a task carries and the other
  two were simply never added.

  Now: on the board line right after the title — it is why that row is in the section you are
  reading, not one more attribute at the end — and in full in `tm show`, since the detail view is
  where an unabridged sentence belongs. The board clamps at 60 characters and ends in `…`, so a row
  stays scannable and is visibly abridged rather than quietly wrong. A reason written across
  several lines is flattened, because one row must stay one row.

  A reason is only shown while it applies. `tm start` on a parked task does not clear
  `parkedReason`, so an in-progress task can still carry the sentence that stopped it once, and
  printing that would say a working task is waiting on something.

  On the card, the reason is **prose, not a chip**. Everything else there is an enumerable fact you
  scan — a priority, an epic, a count — and a Lozenge is the right shape for those; a free-text
  sentence in one either truncates to uselessness or blows the badge row apart. So it gets its own
  line in subtlest text with no background, border or icon: the status mark and the column already
  say the card is stopped, and a callout box would make every blocked card shout. The clamp is on
  the text rather than the box because a CSS line-clamp needs `-webkit-box-orient`, which ADS's
  `cssMap` allowlist rejects — which has the side benefit of being the same rule as `tm board`. The
  full sentence is on hover on both.

- **The plugin read a session id Claude Code does not set, so claims, gates and attribution were
  all inert.** Claude Code sets `CLAUDE_CODE_SESSION_ID`. Every reader except `lib/actor.mjs` asked
  for `CLAUDE_SESSION_ID` alone — eleven sites across the CLI, MCP, the dashboard, the store's event
  stamp, the Stop gate and `tm why`. Measured on this project's own board before the fix:

  ```
  events total            830
    with session non-null   0
  subagent_stop           340
    with a task attributed  0
  claim events              9
    with a session          0
  claim_stolen              0     (advertised as a subscribable notification)
  ```

  What that cost, in a production-shaped environment (only the real variable set):

  ```
  BEFORE   event session stamp: None
           second session claiming the same task: TM-001 in progress — shared work
  AFTER    event session stamp: 'sess-one'
           second session claiming the same task: TM-001 is claimed by main in … on …
  ```

  The claim interlock — the reason every git worktree of a project shares one store — never once
  fired. Two sessions comparing `null !== null` both got "not held by someone else", so parallel
  agents silently took the same task. The Stop gate's session filter was likewise a no-op, so it
  nagged about every `in_progress` task on the board rather than the ones this session claimed.

  **Nine contract suites stayed green through all of it, because they exported the variable
  production never had.** They now export `CLAUDE_CODE_SESSION_ID`, so the session-dependent paths
  are exercised the way they actually run, and one assertion runs with the legacy name explicitly
  unset so it cannot pass by inheritance. `tests/unit/actor.test.mjs` was scrubbing only the fake
  name, which let the test runner's own real session id leak into its fixtures.

  **A claim with no session is now treated as unowned rather than foreign.** Every claim on disk
  anywhere carries `session: null`. The moment a real id flows, `null !== "abc123"` is true and the
  holder of *your own* in-progress task reads as a stranger — `tm start` would refuse work you had
  been resuming freely, and `--steal` would record you stealing from yourself. Adopting a
  null-session claim keeps exactly the behaviour those claims already had while letting real ids
  interlock.

  The Stop gate narrows gradually and deliberately: a task with no recorded session still counts
  toward the gate, so upgrading never silently switches it off — only newly stamped tasks are
  scoped to their own session.

- **`subagent_stop` recorded the parent as the agent, and the parent's transcript as the
  subagent's.** The previous change to this handler was wrong twice, and both errors came from
  guessing at the payload rather than reading Claude Code's schema for it. It selected claims with
  `CLAUDE_SESSION_ID` (never set, so always no claims), and it recorded `input.session_id` as the
  agent and `input.transcript_path` as the agent's transcript — but `SubagentStop` extends the base
  hook payload, so both of those are the **parent's**. The store proves it: the only `agent` values
  ever written are top-level session ids, and the single transcript ever recorded is the parent's
  own conversation file.

  Claude Code documents the real fields: *"Input to command is JSON with `agent_id`, `agent_type`,
  and `agent_transcript_path`."* The subagent's identity had been sitting unread in the payload the
  whole time. The event now carries `agent` from `agent_id`, the new `agent_type`, and the agent's
  own transcript — with `transcript_path` kept only as a fallback for an older Claude Code. The
  parent's session, which is what selects the claims, comes from `input.session_id`, preferring the
  harness telling us directly over inferring it from the environment.

  The contract assertions for that handler encoded the same guess and had to be corrected, not
  merely extended: they fed `session_id` as though it were the subagent's, and passed only because
  the suite injected the session variable production lacks.

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
