# Use cases

Twenty situations the plugin is for. Every case uses the same five sections, in this order.
Commands, MCP tools, and HTTP routes are the ones that exist today (`tm help`, `lib/mcp.mjs`,
`docs/dashboard-api.md`). There is no global `tm` — the project launcher is
`.bytedesk/task-management/bin/tm`.

Agent-first split: the human views, plans, and decides; the agent executes. Surfaces
(CLI / MCP / HTTP) share `lib/` and the same refusal wording. Flags, backends, and harness
recipes: [`agent-first.md`](agent-first.md).

---

## 01. Import a goal doc as a gated task

**Scenario** — A human has a goal markdown (success criteria already written) or a
`*.plan.json` manifest. The agent must turn that into board work whose *done* gate is those
criteria, not a restated title.

**When to use** — A `docs/goals/*.md` (or a `bytedesk-goals` manifest) exists and nothing on
the board is linked to it yet. A silent import with an empty acceptance list would let
`tm done` pass unverified — refuse that.

**Usage**

```
.bytedesk/task-management/bin/tm epic use EP-002          # or epic new first
.bytedesk/task-management/bin/tm goal import docs/goals/acp-pod-A1-codex-image.md
.bytedesk/task-management/bin/tm goal import docs/goals/agent-capability-enhancements.plan.json
```

MCP: `tm_goal_import` `{ "path": "docs/goals/acp-pod-A1-codex-image.md" }` or
`{ "content": "# Goal: …", "name": "pasted goal", "epic": "EP-002" }`.
HTTP: `POST /api/goal/import` `{ "path": "docs/goals/…" }` — 201 `{ id, title, epic, criteria }`;
a manifest returns `{ epic, tasks, skipped, edges }`. Path is confined to the repo.

**Natural language prompts**

- "Import `docs/goals/acp-pod-A1-codex-image.md` onto the board."
- "Turn this goal doc into a task whose acceptance criteria are the success criteria."
- "Load the plan.json manifest as an epic with dependencies and touches."

**Expected outcome** — A `TM-*` exists under the active epic (or the manifest's epic).
`tm show TM-014` lists the criteria unticked. `tm done TM-014` refuses until each is
accepted. Manifest `dependsOn` is `blockedBy`; declared `touches` is `touches`. Exit 2 if
any goal in a manifest was skipped for empty criteria.

---

## 02. Open an epic and file stories and subtasks

**Scenario** — New body of work. Task creation is gated on an active epic. The agent opens
or switches the epic, files cards, sets issue type, and nests subtasks with `parent`.

**When to use** — `tm_task_create` / `tm task new` refused with no active epic. A SessionStart
brief that says the board has no epic. The human says "start an initiative."

**Usage**

```
.bytedesk/task-management/bin/tm epic new "Close the memory gaps"
.bytedesk/task-management/bin/tm epic use EP-002
.bytedesk/task-management/bin/tm task new "Add cursor pagination"
.bytedesk/task-management/bin/tm type TM-014 story
.bytedesk/task-management/bin/tm task new "Cover the empty-page case"
.bytedesk/task-management/bin/tm subtask TM-015 TM-014
```

MCP: `tm_epic` `{ "action": "new", "title": "Close the memory gaps" }` then
`tm_task_create` `{ "title": "Add cursor pagination" }`; `tm_task_field`
`{ "id": "TM-014", "type": "story" }` and `{ "id": "TM-015", "parent": "TM-014" }`.
HTTP: `POST /api/epic` `{ "title": "…" }` (create+activate), `POST /api/task`
`{ "title": "…" }`, `POST /api/task/TM-014/type` `{ "type": "story" }`,
`POST /api/task/TM-015/subtask` `{ "parent": "TM-014" }`. Types: `task|bug|story|spike|chore`.
Subtask-ness is `parent`, not a type. Cycles are refused.

**Natural language prompts**

- "Start an epic for the pagination work and file the first story."
- "Make TM-015 a subtask of TM-014."
- "There's no active epic — open one before we create tasks."

**Expected outcome** — `tm board` shows the epic active. `TM-014` has `type: story`.
`TM-015` has `parent: TM-014`. Creating a task with no epic still 409s with the CLI wording.

---

## 03. Walk a dependency chain with `tm why`

**Scenario** — A card looks blocked. `blockedBy` names only the neighbour. The agent walks
to the root (parked reason, live claim, WIP, cycle, dangling ref) and starts *there*.

**When to use** — The board shows `⊘ TM-001`. Someone asks why it cannot start. `tm start`
just refused and the reason is not obvious from the card.

**Usage**

```
.bytedesk/task-management/bin/tm dep TM-001 TM-002
.bytedesk/task-management/bin/tm dep TM-002 TM-003
.bytedesk/task-management/bin/tm park TM-003 "waiting on counsel"
.bytedesk/task-management/bin/tm why TM-001
.bytedesk/task-management/bin/tm graph --epic EP-002
.bytedesk/task-management/bin/tm dep TM-001 -TM-002    # leading - removes
```

MCP: `tm_task_field` `{ "id": "TM-001", "dep": { "add": ["TM-002"] } }`; `tm_why` `{ "id": "TM-001" }`;
`tm_graph` `{ "epic": "EP-002" }`.
HTTP: `POST /api/task/TM-001/dep` `{ "add": ["TM-002"] }`; `GET /api/task/TM-001/why`;
`GET /api/graph?epic=EP-002`. `startable: yes` means `tm start` will succeed. `parked` is
reported but not counted as blocking — `tm start` resumes a parked task.

**Natural language prompts**

- "Why can't we start TM-001?"
- "What's actually at the bottom of this blocker chain?"
- "Draw the dependency graph for EP-002."

**Expected outcome** — `tm why` prints the chain and `start here: TM-003`. JSON `roots` is
the unblocked work at the bottom. A cycle is refused at write time. `tm graph` is Mermaid
the PR diff can render.

---

## 04. Claim a task so parallel sessions don't collide

**Scenario** — Two agents (or a human and an agent) share one store via git worktrees.
Without a claim, both start TM-014. The agent takes exclusive ownership before editing.

**When to use** — `tm next` returned a card another session might also pick. `tm start`
refused naming a holder. Several worktrees, one board.

**Usage**

```
.bytedesk/task-management/bin/tm next
.bytedesk/task-management/bin/tm start TM-014
.bytedesk/task-management/bin/tm claim TM-014
.bytedesk/task-management/bin/tm start TM-014 --steal
.bytedesk/task-management/bin/tm claim TM-014 --steal
.bytedesk/task-management/bin/tm parallel --epic EP-002
.bytedesk/task-management/bin/tm release TM-014
```

MCP: `tm_next`; `tm_task_update` `{ "id": "TM-014", "action": "start" }`; `tm_claim`
`{ "id": "TM-014", "steal": false }`; `tm_parallel` `{ "epic": "EP-002" }`.
HTTP: `POST /api/task/TM-014/transition` `{ "status": "in_progress" }` (WIP + claim);
`POST /api/task/TM-014/claim` `{ "steal": false }` — claim only, no status change;
`GET /api/claims`; `GET /api/parallel?epic=EP-002`; `POST /api/task/TM-014/release`.
`--steal` is refused unless passed, and logged as `claim_stolen`. `tm parallel` batches
unblocked, unclaimed tasks whose `touches` do not collide.

**Natural language prompts**

- "Start TM-014 — don't steal it if someone else has it."
- "What can we run in parallel on EP-002?"
- "Take TM-014 from the other session; I know they're gone."

**Expected outcome** — `state.json` claims TM-014 for this session. A second `tm start`
without `--steal` names the holder. `tm parallel` returns disjoint batches. Claims expire
(`claimTtlMinutes`, default 240).

---

## 05. Provision an isolated worktree

**Scenario** — Parallel work on the same repo. The agent checks out an isolated tree for
the task, with `node_modules` shared, instead of dirtying `main`.

**When to use** — `tm parallel` said two cards can run together. Dispatch does this as
part of the hand-off; a human session can do it alone.

**Usage**

```
.bytedesk/task-management/bin/tm worktree new TM-014
.bytedesk/task-management/bin/tm worktree new TM-014 --base origin/main --no-share
.bytedesk/task-management/bin/tm worktree list
.bytedesk/task-management/bin/tm worktree rm TM-014
.bytedesk/task-management/bin/tm worktree rm TM-014 --force
```

MCP: `tm_worktree` `{ "action": "new", "id": "TM-014", "base": "origin/main", "share": true }`.
HTTP: `POST /api/task/TM-014/worktree` `{ "action": "create" }`; `GET /api/worktrees`;
remove `{ "action": "remove", "force": true }`. Provision **claims first** — a live foreign
claim is refused with nothing on disk. Default share: `node_modules` symlink, `.env` copy
(`worktreeShare`). Branch `tm/<id>-<slug>` (`branchPrefix`). `--no-share` when the task
changes dependencies.

**Natural language prompts**

- "Give TM-014 its own worktree."
- "List the worktrees and drop TM-014's even if it's dirty."
- "Branch TM-014 from origin/main, don't share node_modules."

**Expected outcome** — A checkout under `.bytedesk/worktrees/`, branch `tm/TM-014-…`,
claim stamped with that path. `tm worktree rm` unlinks shares then removes. Dirty remove
without `force` is 409.

---

## 06. Rank a sprint and the backlog

**Scenario** — The human commits a fortnight of work. The agent creates a sprint, adds
cards, and ranks the backlog so `tm next` is a decision, not id order.

**When to use** — Planning a slice of time. `tm next` is putting the wrong card first.
Cards need a sprint report (committed vs done vs unsized).

**Usage**

```
.bytedesk/task-management/bin/tm sprint new "Sprint 12" --ends 2026-08-14
.bytedesk/task-management/bin/tm sprint add TM-014 TM-015
.bytedesk/task-management/bin/tm rank TM-014 --before TM-015
.bytedesk/task-management/bin/tm backlog
.bytedesk/task-management/bin/tm sprint show
.bytedesk/task-management/bin/tm sprint done
```

MCP: `tm_sprint` `{ "action": "new", "title": "Sprint 12", "ends": "2026-08-14" }` then
`{ "action": "add", "tasks": ["TM-014", "TM-015"] }`; `tm_task_field`
`{ "id": "TM-014", "rank": { "before": "TM-015" } }`.
HTTP: `POST /api/sprint` `{ "title": "Sprint 12", "ends": "2026-08-14" }`;
`POST /api/task/TM-014/sprint` `{ "sprint": "SP-001" }`; `POST /api/task/TM-014/rank`
`{ "before": "TM-015" }`; `GET /api/backlog`; `GET /api/sprint/SP-001`. Closing a sprint
does not evaporate unfinished cards (`unfinished` count). `tm next` orders by explicit
rank, then priority (unset = medium), then id.

**Natural language prompts**

- "Open Sprint 12 ending 14 August and put TM-014 and TM-015 in it."
- "Rank TM-014 ahead of TM-015."
- "Show the backlog and close the sprint."

**Expected outcome** — Active sprint is SP-*. Those tasks have `sprint`. `tm backlog` /
`GET /api/backlog` is rank order. `tm sprint done` leaves leftover cards on the board.

---

## 07. Standup from the event log

**Scenario** — A human (or an agent writing a status) needs what moved since yesterday,
not a remembered todo list. The store's event log is the authority.

**When to use** — "What did we do yesterday." Session resume. A progress comment for
someone who was not in the sessions.

**Usage**

```
.bytedesk/task-management/bin/tm standup
.bytedesk/task-management/bin/tm standup 2026-09-01T00:00:00.000Z
.bytedesk/task-management/bin/tm log 40
.bytedesk/task-management/bin/tm log TM-014
```

MCP: `tm_standup` `{ "since": "2026-09-01T00:00:00.000Z" }`; `tm_log`; `tm_history`
`{ "id": "TM-014" }`.
HTTP: `GET /api/standup?since=2026-09-01T00:00:00.000Z`; `GET /api/events`;
`GET /api/entity/TM-014/history`. Default window is now−24h. Status-changing writes
render as `→ blocked`; a generic `update` explained by a specific event in the same
second is dropped.

**Natural language prompts**

- "Standup."
- "What changed on the board since Monday?"
- "Show TM-014's history."

**Expected outcome** — Markdown: finished, in progress, stuck (with stop reasons), then
work that moved no status. Same collapsing as `tm log` and the dashboard `/activity`.

---

## 08. Hand a task off to another session

**Scenario** — This session is stopping, a subagent is spinning up, or tomorrow's agent
must pick up cold. The agent emits a self-contained brief from the store, not a recap.

**When to use** — Delegating. Opening a worktree for someone else. Ending mid-task.
Never as advice to a *dispatched* worker — dispatch already claimed the card.

**Usage**

```
.bytedesk/task-management/bin/tm handoff TM-014
.bytedesk/task-management/bin/tm park TM-014 "stopped at the vendor SDK mock"
```

MCP: `tm_handoff` `{ "id": "TM-014" }`.
HTTP: `GET /api/task/TM-014/handoff` `{ id, text }` — GET never provisions a worktree
(`POST /api/task/:id/worktree` does). The brief includes epic, branch/worktree, body,
acceptance, blockers, evidence, commits, and ends `Resume with: tm start TM-014`.
Park if this session is leaving; leave `in_progress` only if someone is continuing.

**Natural language prompts**

- "Write a handoff for TM-014."
- "I'm done for today — park TM-014 and give me the brief for tomorrow."
- "Brief the subagent on this task."

**Expected outcome** — Markdown the next agent can paste as its prompt. After `tm park`,
the card shows the reason; `tm start` in the *next* session takes the claim.

---

## 09. Chart a decision map

**Scenario** — The destination is nameable, the route is not. The human decides; the
agent charts an epic labelled `decision:map` whose children are questions
(`decision:interview|research|prototype|unblock`), not build slices.

**When to use** — Bigger than one session. `/map`. "Too foggy to ticket implementation."
Do not put `decision:*` on implementation cards.

**Usage**

```
.bytedesk/task-management/bin/tm epic new "How we persist session memory"
.bytedesk/task-management/bin/tm label EP-010 decision:map
.bytedesk/task-management/bin/tm task new --template interview "What does done look like"
.bytedesk/task-management/bin/tm label TM-020 decision:interview
.bytedesk/task-management/bin/tm task new --template research "What do comparable tools store"
.bytedesk/task-management/bin/tm label TM-021 decision:research
```

MCP: `tm_epic` `{ "action": "new", "title": "How we persist session memory" }`; `tm_label`
`{ "id": "EP-010", "add": ["decision:map"] }` (`decision:map` is epic-only);
`tm_task_create` `{ "title": "What does done look like", "labels": ["decision:interview"] }`.
HTTP: `POST /api/epic` `{ "title": "…" }` then `POST /api/task` `{ "title": "…", "labels": ["decision:interview"] }`.
`POST /api/task/:id/labels` is task-kind only — label the map epic with CLI `tm label` or MCP `tm_label`.

**Natural language prompts**

- "Chart how we persist session memory — don't build it yet."
- "This is too big for one session; start a decision map."
- "Add a research ticket under the map for what comparable tools store."

**Expected outcome** — Epic wears `decision:map`. Children wear `decision:*` and have
acceptance. `tm next` on that epic returns questions. No implementation `ready-for-agent`
cards mixed in.

---

## 10. Propose and ship a capability

**Scenario** — "What should we build next" must outlive the session. The agent proposes
sized capabilities; the human accepts; accept mints the task; ship requires evidence.

**When to use** — `/enhance`. Capability backlog. Not the same as filing a task — proposing
is not committing.

**Usage**

```
.bytedesk/task-management/bin/tm cap list --status open
.bytedesk/task-management/bin/tm cap new "Operator can rotate a provider key in the UI" --area ux --impact H --effort M --confidence M --source research
.bytedesk/task-management/bin/tm cap accept CAP-0046
.bytedesk/task-management/bin/tm cap ship CAP-0046 --evidence tests/unit/keys.test.mjs
.bytedesk/task-management/bin/tm cap drop CAP-0047
```

MCP: `tm_cap_list` `{ "status": "open" }`; `tm_cap_propose` `{ "title": "…", "area": "ux",
"impact": "H", "effort": "M", "confidence": "M", "source": "research", "criteria": ["…"] }`;
`tm_cap_accept` `{ "id": "CAP-0046" }`; `tm_cap_ship` `{ "id": "CAP-0046" }` (evidence must
already be on the minted task via `tm_evidence`); `tm_cap_drop` `{ "id": "CAP-0047" }`.
HTTP: `POST /api/capability`; `POST /api/capability/CAP-0046/accept`;
`POST /api/capability/CAP-0046/ship` `{ "evidence": "…" }` — 409 `"no evidence"`;
`POST /api/capability/CAP-0046/drop`. Score is impact × ease × confidence (1–27).

**Natural language prompts**

- "What's on the enhancement backlog?"
- "Propose a capability: rotate provider keys in the UI."
- "We shipped CAP-0046 — mark it with the keys test as evidence."

**Expected outcome** — `CAP-*` ranked in `tm cap list`. Accept creates a `TM-*` whose
acceptance criteria *are* the capability's. Ship refuses without evidence. Drop records
the reason; it is not deleted from history.

---

## 11. Tick acceptance criteria and attach evidence

**Scenario** — The agent implemented a slice. Closing is gated on ticked criteria.
Assertions are not proof — a log or screenshot is.

**When to use** — After a test went red then green. Before `tm done`. A criterion was
mis-ticked or should never have been there.

**Usage**

```
.bytedesk/task-management/bin/tm ac TM-014 "the empty page returns []"
.bytedesk/task-management/bin/tm evidence TM-014 tests/unit/pagination.test.mjs
.bytedesk/task-management/bin/tm accept TM-014 1
.bytedesk/task-management/bin/tm accept TM-014 1 --undo
.bytedesk/task-management/bin/tm ac TM-014 --rm 2
.bytedesk/task-management/bin/tm done TM-014
```

MCP: `tm_ac_add` `{ "id": "TM-014", "text": "the empty page returns []" }`; `tm_evidence`
`{ "id": "TM-014", "path": "tests/unit/pagination.test.mjs" }` or `{ "text": "…" }`;
`tm_ac_accept` `{ "id": "TM-014", "index": 1 }` (`undo` / `remove`); `tm_task_update`
`{ "id": "TM-014", "action": "done" }`.
HTTP: `POST /api/task/TM-014/ac` `{ "text": "…" }`; `POST /api/task/TM-014/evidence`
`{ "path": "…" }` or multipart `file`; `POST /api/task/TM-014/accept`
`{ "index": 1, "done": true }`; `POST /api/task/TM-014/transition` `{ "status": "done" }`
— 409 `gateDone` if any criterion is open. Untick does not reopen a done task
(`done-unmet` is doctor's to report). Remove renumbers.

**Natural language prompts**

- "Add an acceptance criterion for the empty page, attach the unit test, tick it, close TM-014."
- "I ticked AC 1 by mistake — undo it."
- "Remove criterion 2, it should never have been there."

**Expected outcome** — Frontmatter `acceptance[].done` is true with `at`. Evidence file
under `.bytedesk/task-management/evidence/`. `tm done` succeeds and releases the claim.
A done attempt with an open criterion is refused in the CLI's words on all three surfaces.

---

## 12. Reach a phone with ntfy

**Scenario** — Agents run unattended. The dashboard Notification API only works with a
browser open. ntfy reaches a phone. The token stays in the environment, never `config.json`.

**When to use** — Several workers on a board, human not watching the SPA. Stop-gate,
stolen claims, dispatch/result, reaper events matter; bookkeeping must not buzz.

**Usage**

```
export TM_NTFY_TOKEN=…
.bytedesk/task-management/bin/tm ntfy topic my-board
.bytedesk/task-management/bin/tm ntfy enable
.bytedesk/task-management/bin/tm ntfy on recommended
.bytedesk/task-management/bin/tm ntfy on dispatched task_result agent_reaped
.bytedesk/task-management/bin/tm ntfy off update
.bytedesk/task-management/bin/tm ntfy test
.bytedesk/task-management/bin/tm ntfy
```

No MCP tool. HTTP: `GET /api/ntfy` (token never returned); `POST /api/ntfy/test`
`{ "event": "stop_gate_blocked" }` — `{ sent }` or `reason` from `shouldPublish`.
Kinds are the store's event catalog (`stop_gate_blocked`, `claim_stolen`, `dispatched`,
`task_result`, `agent_reaped`, …). Every kind is off until switched on. `ntfy.server`
defaults to `https://ntfy.prod.bytedesk.ai`.

**Natural language prompts**

- "Enable ntfy on the recommended kinds and send a test."
- "Buzz my phone when a worker is dispatched or reaped."
- "What's ntfy doing on this board?"

**Expected outcome** — `tm ntfy` shows enabled, server/topic, and a checklist of kinds.
`tm ntfy test` prints `sent to <server>/<topic>` or the decline reason. A missing token
or topic is a refusal, not a thrown hook.

---

## 13. Probe what this host can dispatch

**Scenario** — Before handing work to a worker, the agent asks what this machine can
actually launch. Missing binaries are `available: false` plus a reason, never an exception.

**When to use** — First dispatch on a host. A dispatch refusal listed `tried`. Wiring a
new harness. CI vs a laptop.

**Usage**

```
.bytedesk/task-management/bin/tm caps
.bytedesk/task-management/bin/tm caps --json
TM_HOSTCAPS_DEBUG=1 .bytedesk/task-management/bin/tm caps --json
```

No MCP tool — shell the CLI or hit HTTP `GET /api/caps`. Report shape:
`{ backends: { orchestration, fleet, tmux, manual }, clis, sandbox }`. `manual` is always
available. Overrides: `TM_ORCHESTRATION_BIN`, `TM_FLEET_BIN`. Probe order for plugin
bins: env → sibling marketplace checkout → `~/.claude/plugins/**`. CLIs:
`claude|codex|grok|kimi` on PATH. Sandbox: `bwrap`, `systemd-run`, `slirp4netns`.

**Natural language prompts**

- "What can this machine dispatch work to?"
- "Show host capabilities as JSON."
- "Why is orchestration unavailable here?"

**Expected outcome** — Human text or `--json` with `available` / `reason` / `path` per
backend. A bare machine with no board still answers. `tmux: unavailable (tmux is not on
PATH)` is a successful probe.

---

## 14. Dispatch a ready-for-agent task (four backends)

**Scenario** — The human already decided (label `ready-for-agent`). This session must not
implement the card. The agent hands it to a worker: claim, start (WIP applies), worktree,
handoff, spawn. Backends, richest first: **orchestration → fleet → tmux → manual**.

**When to use** — A labelled, unblocked card. "Run this on an agent." Pin a backend when
the fallback would land in a harness nobody is watching.

**Usage**

```
.bytedesk/task-management/bin/tm label TM-014 ready-for-agent
.bytedesk/task-management/bin/tm caps --json
.bytedesk/task-management/bin/tm dispatch TM-014
.bytedesk/task-management/bin/tm dispatch TM-014 --backend orchestration
.bytedesk/task-management/bin/tm dispatch TM-014 --backend fleet
.bytedesk/task-management/bin/tm dispatch TM-014 --backend tmux
.bytedesk/task-management/bin/tm dispatch TM-014 --backend manual
.bytedesk/task-management/bin/tm dispatch TM-014 --steal
```

MCP: `tm_dispatch` `{ "id": "TM-014", "backend": "tmux", "steal": false }`.
HTTP: `POST /api/task/TM-014/dispatch` `{ "backend": "tmux" }` — 409 is `gateStart`, a
held claim, or no backend (`tried` lists why). `--backend` skips the walk. Config
`dispatch.backends` overrides the default list. Every spawn is argv-only, `shell: false`.

| Backend | What starts | Distinguishing fact |
|---|---|---|
| `orchestration` | agent-orchestration MCP `spawn` | idempotency key `<task>-<session>` |
| `fleet` | `spawn-claude-feature` | `CLAUDE_SESSION_TICKET` so the recursion guard engages |
| `tmux` | session `tm-<id>` | durable prompt at `<worktree>/.tm-dispatch-prompt.md` |
| `manual` | nothing | prints the commands; never unavailable |

Worker env: `TM_SESSION_ID`, `TM_ACTOR` (dispatcher), `TM_ROOT`. Do not override.
Already dispatched with a live claim: collect first, or `--steal`. Failure after a claim
this call created rolls the card back to open.

**Natural language prompts**

- "Dispatch TM-014 to whatever this host can run."
- "Pin TM-014 to tmux."
- "Hand TM-014 to me as manual — no launcher."

**Expected outcome** — Task `in_progress`, `dispatched: { backend, run, session, at }`,
worktree on disk, agent registered as `agent:TM-014-<session-prefix>`. `manual` still
`ok: true` with the commands in `detail`. A second dispatch without `--steal` names the
holder and the backend.

---

## 15. Drain labelled work with the pool

**Scenario** — Several `ready-for-agent` cards are waiting. A human opted in. The agent
starts the pickup loop instead of dispatching one-by-one. Unlabelled work is never touched.

**When to use** — "Start the worker pool." Many labelled cards. After `tm config
dispatch.enabled true` so the `tm-pool` monitor will actually run.

**Usage**

```
.bytedesk/task-management/bin/tm config dispatch.enabled true
.bytedesk/task-management/bin/tm pool once --dry-run
.bytedesk/task-management/bin/tm pool once
.bytedesk/task-management/bin/tm pool start
.bytedesk/task-management/bin/tm pool status
.bytedesk/task-management/bin/tm pool stop
```

No MCP or HTTP verb. The plugin monitor `tm-pool` runs `tm pool run --auto` and **exits 0
immediately** unless `dispatch.enabled` is true. Explicit `once|start` work regardless of
that flag; a tick still no-ops under `TM_ENFORCE=off` or `dispatch.enabled: false`. Each
tick collects finished workers first, then dispatches up to `dispatch.poolWip` (default 3)
preferring disjoint `touches`. `dispatch.pollSeconds` default 30.
`dispatch.backendCaps` e.g. `{"tmux":2}`.

**Natural language prompts**

- "Dry-run the pool — what would it pick?"
- "Enable the pool and start it."
- "Stop the worker pool."

**Expected outcome** — `--dry-run` names candidates without claiming. `once` dispatches up
to the cap. `start` writes `pool.pid`. `status` shows the live pid or none. Unlabelled
cards stay `open`.

---

## 16. Registry, heartbeat, and reap

**Scenario** — Dispatch registered workers in per-machine `agents.json`. The board still
shows `in_progress` for a process that died. The agent lists liveness, heartbeats a name,
or reaps the quiet ones — reaping parks their tasks and releases claims.

**When to use** — "Who is running." A dispatched card looks abandoned. After a host crash.

**Usage**

```
.bytedesk/task-management/bin/tm agent
.bytedesk/task-management/bin/tm agent heartbeat agent:TM-014-dispatch
.bytedesk/task-management/bin/tm agent reap
```

MCP: `tm_agents` `{ "action": "list" }`; `{ "action": "heartbeat", "name": "agent:TM-014-dispatch" }`;
`{ "action": "reap" }`.
HTTP: `GET /api/agents` — list with derived `alive`. Heartbeat/reap are CLI/MCP.
Liveness: live pid, or a heartbeat fresher than `agentTtlMinutes` (default 30; `0`
disables). Dispatch also re-stamps the *claim* every `dispatch.heartbeatSeconds`
(default 60; `0` disables). A broken `agents.json` is a missing panel, never a failed
dispatch.

**Natural language prompts**

- "Who is running on this machine?"
- "Heartbeat agent:TM-014-dispatch."
- "Reap dead workers and unstick the board."

**Expected outcome** — `tm agent` lists name, backend, run, pid, `alive`. Reap marks quiet
agents dead, parks their claimed tasks with a reason, releases claims, logs `agent_reaped`
/ `worker_reaped`. Those cards are no longer `in_progress`.

---

## 17. Collect a worker's result

**Scenario** — A dispatched worker exited. The agent pulls the backend's completion signal
into the store. Collect never closes the task — the worker closes through `tm done`. A
false "done" on an open card downgrades to failed.

**When to use** — After dispatch/pool. `tm agent` shows a dead worker still holding a card.
The human asks what happened to that run.

**Usage**

```
.bytedesk/task-management/bin/tm collect TM-014
```

MCP: `tm_collect` `{ "id": "TM-014" }`.
HTTP: `POST /api/task/TM-014/collect`. Signals: orchestration terminal states
`succeeded|failed|cancelled|timed_out|rejected|recovery_required`; tmux session `tm-<id>`
gone; fleet ticket event `merge` → done, `error` → failed; `manual` has nothing to collect.
Returns `{ ok, outcome, downgraded?, parked? }` or `{ ok, pending: true }` while the worker
runs. `blocked`/`failed` on still-`in_progress` parks with the summary and releases the
claim. Comment + `task_result` event. Refusal: not found; never dispatched; no collector.

**Natural language prompts**

- "Collect TM-014."
- "What was the result of the worker on TM-014?"
- "Pull the dispatched run back onto the board."

**Expected outcome** — `tm log TM-014` shows `task_result` `{ id, run, outcome }`. A
successful worker that already `tm done`'d stays done. A crash becomes `parked` with the
reason, claim gone. Pending if the tmux session or orchestration run is still live.

---

## 18. Tail events and fan them to webhooks

**Scenario** — A machine, not a person, needs the store's writes. `tm log` is labelled
prose. `tm events --json` is the JSONL row. Webhooks POST that same row.

**When to use** — Subscribers. Following dispatch/collect. Wiring an external bus. `tm log`
is the wrong shape.

**Usage**

```
.bytedesk/task-management/bin/tm events
.bytedesk/task-management/bin/tm events 40 --json
.bytedesk/task-management/bin/tm events --since 2026-09-01T00:00:00.000Z --json
.bytedesk/task-management/bin/tm events --follow --json
.bytedesk/task-management/bin/tm config webhooks '[{"url":"http://127.0.0.1:9999/hook","kinds":["dispatched","task_result"]}]'
```

No MCP tool. HTTP: `GET /api/events?since=&limit=&id=`; SSE `GET /events` (`Last-Event-ID`).
`--json` is JSONL (one object per line), not a pretty array. `--follow` is a byte-offset
tail that survives rotation (`eventMaxBytes`, default 5 MB); SIGINT exits 0. A bad
`--since` is refused. Webhooks: loopback only (`127.0.0.1`, `localhost`, `*.local`) unless
`webhooksAllowRemote: true`. Delivery is detached `bin/tm-webhook`. `kinds` filters on the
event name.

**Natural language prompts**

- "Tail board events as JSONL."
- "Follow new events since midnight."
- "Webhook dispatched and task_result to localhost:9999."

**Expected outcome** — `--json` lines parse as `{ ts, event, session, actor, … }`. Follow
prints rows written after start and keeps going after `events.jsonl` rotates. A loopback
webhook receives the exact JSONL object. A remote URL is refused until the flag is set.

---

## 19. Run the same board from Claude, Codex, Grok, or Kimi

**Scenario** — The store, CLI, and MCP server are harness-agnostic. Hooks and session
identity are not. The agent registers MCP the way *this* CLI requires and does not guess
a session variable the host does not export.

**When to use** — First attach of the plugin on Codex/Grok/Kimi. Claims attributing to
nobody. "Does this work under Grok?"

**Usage**

Claude Code: `.mcp.json` already points at `bin/tm-mcp`. Session:
`CLAUDE_CODE_SESSION_ID`. Native `TaskCreate` / `TaskUpdate` are mirrored.

```
codex mcp add task-management -- <plugin>/bin/tm-mcp
grep -v '^//' <plugin>/hooks/codex-hooks.example.json > .codex/hooks.json
```

Codex session is payload `session_id` (no env); the hook adopts it as `TM_SESSION_ID`.
Native `update_plan`.

```
grok mcp add task-management -- <plugin>/bin/tm-mcp
```

Grok session: `GROK_SESSION_ID`. Native `todo_write`. **No hook surface** — no SessionStart
brief, Stop gate, or automatic commit linking. Drive CLI/MCP. Claims still hold.

Kimi — no `mcp add`. Write `.kimi-code/mcp.json` (or `~/.kimi-code/mcp.json`):

```json
{ "mcpServers": { "task-management": { "command": "<plugin>/bin/tm-mcp" } } }
```

Append `hooks/kimi-hooks.example.toml` to `~/.kimi-code/config.toml`. Session is payload
`session_id` → `TM_SESSION_ID`. Native `TodoList`.

HTTP `GET /api/sessions` reports `harness: "claude"|"codex"|"grok"|"kimi"|null`.

**Natural language prompts**

- "Wire task-management MCP for Codex."
- "We're on Grok — drive the board with MCP, we have no hooks."
- "Add the Kimi MCP stdio entry and the example hooks."

**Expected outcome** — `tools/list` returns the 38 `tm_*` tools. A write stamps `session`
from that harness's id. Grok has no Stop gate; Codex/Kimi claims work because the hook
copied `session_id` onto `TM_SESSION_ID`. `GET /api/sessions` names the harness.

---

## 20. Point several checkouts at one store with `TM_ROOT`

**Scenario** — Worktrees of one repo already share a store (`--git-common-dir`). A
different clone, a CI job, or a plugin source checkout needs to *choose* the board.
`TM_ROOT` is that pointer. The plugin refuses to create a store inside an *installed*
copy of itself (`~/.claude/plugins`).

**When to use** — CI. Two checkouts of the same project. "The board is in the other
tree." Dispatch already sets `TM_ROOT` on the worker to the repo it came from.

**Usage**

```
TM_ROOT=/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace \
  .bytedesk/task-management/bin/tm board
TM_ROOT=/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace \
  .bytedesk/task-management/bin/tm dispatch TM-014 --backend tmux
```

Resolution if unset: `TM_ROOT` → executing project (`CLAUDE_PROJECT_DIR`) → cwd's repo.
MCP and HTTP inherit the same `paths()` — start `tm-mcp` / `tm-dashboard` with `TM_ROOT`
set when the process cwd is not the board. Worker env from dispatch already includes
`TM_ROOT`; do not override it in the worker.

**Natural language prompts**

- "The board lives in the marketplace checkout — set TM_ROOT and show it."
- "Dispatch TM-014 from this worktree against the shared store."
- "Don't init a store inside the installed plugin."

**Expected outcome** — `tm board` / `tm_board` / `GET /api/board` read
`<TM_ROOT>/.bytedesk/task-management/`. Claims taken in one worktree are visible in the
other. `tm init` under `~/.claude/plugins/…/task-management` is refused. A dispatched
worker's `tm done` attributes to the dispatching session against that store.
