# Dashboard HTTP contract

The contract the rewritten dashboard (`dashboard/`) and the backend worker code against.
Existing routes are listed as they are implemented today in `lib/dashboard-api.mjs` and
`bin/tm-dashboard`. (The rewrite's routes all shipped; the per-row **NEW** markers they
carried while landing are removed.) Every mutation delegates to the
same `lib/` function the CLI calls — never to the filesystem directly — so gates, the event log
and the markdown store stay authoritative regardless of caller.

## 1. Conventions

- **Bind**: `127.0.0.1` only. No auth, no CORS headers. Writes (POST/PATCH) with an `Origin` header
  that is not `http://127.0.0.1:` / `http://localhost:` are refused **403** (`bin/tm-dashboard`,
  write branch). A request with no Origin (curl) passes.
- **Body caps**: JSON 256 KB → **413**; multipart (evidence upload only) 8 MB → **413**. Invalid
  JSON → **400** `{ error: "body is not valid JSON" }`.
- **Status semantics**: **409** = a gate or lifecycle rule refused, `error` carries the CLI's own
  wording. **400** = bad input (unknown status, bad id prefix, validation from `lib/issue.mjs`,
  missing required field). **404** = entity missing, or unknown `:action`. **405** = wrong method on
  a known path. **500** = a write threw; the board stays up (`{ error }`).
- **Every response is JSON** `{ ... }` on success or `{ error: string }` on failure, except the
  raw-byte routes (`/api/task/:id/file`, `/api/export`) and the SSE streams.
- **Ids** are URL-decoded and kind-checked (`requireKind`, `lib/dashboard-api.mjs:73`). Per-kind
  routes stay strict: `GET /api/task/EP-*` is **400**, the epic lives at `/api/epic/:id`.
  `/api/entity/:id` is the generic `kindOf`+`read` and does not replace per-kind routes.
- **`handleWrite(method, path, payload, { p })`** (`lib/dashboard-api.mjs:108`) is pure
  request-in/response-out, returns `{ status, body }`, and unit-tests without a server.
  `bin/tm-dashboard` is plumbing. `handleWrite` stays synchronous; `export async function handleAsync(method, path, payload, {p, fetchImpl})` wraps it and owns the async routes (`/api/ntfy/test`, `/api/task/:id/dispatch`, `/api/task/:id/collect`). `bin/tm-dashboard` calls `handleAsync` for every request;
  the server `await`s it.
- **Single GET dispatch rule**: `bin/tm-dashboard` routes every `GET /api/*` to
  `handleWrite("GET", …)` **except** the server routes that need raw bodies or streams:
  `/api/board`, `/api/events`, `/events`, `/api/task/:id/file`, `/api/task/:id/stream`,
  `/api/export`. Consequence: `GET /api/nope` is 404 JSON, never the SPA shell.
- **Stamp**: writes that take a claim carry `{ actor, session, branch, worktree }` from `stamp(p)`
  (`lib/actor.mjs`); `bin/tm` uses the same.
- **Vocabulary** is never hardcoded in the SPA — read it from `GET /api/meta` (§4).

## 2. Route table

Legend: **R** read · **W** write · **G** gated write (409 possible).

### 2.1 Board, events, streams (served in `bin/tm-dashboard`)

| Method · Path | Query / body | Response | Codes | Source |
|---|---|---|---|---|
| `GET /api/board` R | — | `boardPayload` §3 | 200 | `lib/dashboard-api.mjs boardPayload` |
| `GET /api/events` R | `since=<iso>`, `limit=<n≤5000>` (default last 2000), `id=<entity>` | `StoreEvent[]` — each row + `label` (from `CATALOG.events`), `_shadowed`, `_status` via `collapseLog(rows,{keep:true})` | 200 | `bin/tm-dashboard`; reads via `store.readEvents` (includes rotated generation) |
| `GET /events` SSE | header `Last-Event-ID` | see §5 | 200 | `bin/tm-dashboard` |
| `GET /api/task/:id/stream` SSE | — | `data: {messages, session, file, harness, reason}` every 2 s when changed | 200 / 404 | `lib/transcript.mjs workStream` |
| `GET /api/task/:id/file` R | `ref=` | raw bytes, content-type by ext, `content-disposition: inline` | 200 / 404 | `evidence.servableEvidencePath` (ref must be on the task AND realpath inside `p.evidence`) |
| `GET /api/export` R | `format=md\|csv\|json` (required), `epic`, `status`, `open=1`, `events=1`, `download=1` | raw text; `text/markdown` / `text/csv` / `application/json`; `content-disposition: attachment; filename="<project>-board.<ext>"` when `download=1` | 200 / 400 unknown format | `export.exportStore` (`lib/export.mjs:196`) |

### 2.2 Meta, settings, vocab

| Method · Path | Query / body | Response | Codes | Source |
|---|---|---|---|---|
| `GET /api/meta` R | — | §4 | 200 | new `meta(p)` in dashboard-api |
| `GET /api/settings` R | — | `{ groups:[{id,label,help}], fields:[{key,group,type,default,label,help,min?,max?,options?,readOnly?,value}], ntfy:{token:bool,active:bool} }` | 200 | `settings.settingsSnapshot` (`lib/settings.mjs:132`) |
| `POST /api/settings` W | `{ <key>: value, … }` allowlisted by CATALOG | `{ board, applied:[keys], ignored:[keys] }` | 200 / 400 (identity key, non-object body) | `settings.applySettings` (`:157`), logs `settings` |
| `GET /api/skills` R | — | `[{ name, description, userInvokable, command:"/task-management:<name>" }]` | 200 | new `lib/skills.mjs listSkills(pluginRoot)` reading `skills/*/SKILL.md` frontmatter |
| `GET /api/templates` R | — | `[{ name, description }]` | 200 | `templates.listTemplates` |
| `GET /api/templates/:name` R | — | `{ name, fields, body }` | 200 / 400 unsafe name / 404 | `templates.readTemplate` |
| `POST /api/templates` W | `{ name, description?, fields?, body, overwrite? }` | 201 `{ name }` | 201 / 400 unsafe name / 409 exists without `overwrite` | new `templates.writeTemplate` |
| `PATCH /api/templates/:name` W | `{ description?, fields?, body? }` | `{ name, fields, body }` | 200 / 404 | `templates.writeTemplate({overwrite:true})` |

### 2.3 Tasks

| Method · Path | Query / body | Response | Codes | Source |
|---|---|---|---|---|
| `GET /api/task/:id` R | — | full task incl. `body` | 200 / 400 non-task id / 404 | `store.read` |
| `GET /api/backlog` R | — | `Task[]` in rank order (body stripped) | 200 | `issue.backlog` |
| `GET /api/entity/:id` R | — | any kind, full record | 200 / 400 unknown prefix / 404 | `store.kindOf`+`read` |
| `GET /api/task/:id/evidence` R | — | `{ evidence:[{ ref, kind:"file"\|"url"\|"uri", name, exists, previewable }] }` | 200 | `evidence.listEvidence` |
| `GET /api/task/:id/why` R | — | `{ id, title, status, startable, reasons:[{kind,blocking,text}], chain:[{id,depth,status,reason}], roots:[ids], cycles:[[ids]], text }` | 200 / 404 | `graph.why` (`lib/graph.mjs:86`), `renderWhy` (`:176`) |
| `GET /api/task/:id/handoff` R | — | `{ id, text }` (markdown brief). Worktree provisioning is `POST …/worktree`, never a GET side effect | 200 | `render.handoff` (`lib/render.mjs:264`) |
| `GET /api/task/:id/time` R | — | `{ id, cycle:{startedAt,doneAt,ms,human}\|null, inStatus:{<status>:ms}, timeline:[{ts,from,to}] }` | 200 | `time.cycleTime/timeInStatus/taskTimeline` (`lib/time.mjs:78,67,43`) |
| `GET /api/entity/:id/history` R (alias: `GET /api/task/:id/history`, same payload) | `raw=1` | `{ id, events:[labelled rows for this id], text }` — any kind | 200 / 404 | `store.readEvents` filtered by id, `render.renderHistory` (`:456`), `collapseLog` |
| `POST /api/task` G | `{ title, epic?, body?, assignee?, priority?, template?, acceptance? }` | 201 `{ id, title, epic }` | 201 / 400 / 409 `gateTaskCreate` | `enforce.gateTaskCreate`, `templates.applyTemplate`, `store.create` |
| `PATCH /api/task/:id` W | `{ title?, body?, epic? }` (`epic:null` detaches) | merged record + `{ edited:[…] , …moveTask result }` | 200 / 400 nothing to change | `store.editTask`, `store.moveTask` |
| `POST /api/task/:id/transition` G | `{ status, reason? }` | `{ id, status, unblocked?:[ids], closedEpic? }` | 200 / 400 unknown status / 409 `gateDone` or `gateStart` (WIP) | `enforce.gateDone`; `enforce.gateStart`; `claims.claimTask` on in_progress, `store.release` otherwise; `unblockDependents`, `autoCloseEpic` |
| `POST /api/task/:id/edit` W | same as PATCH | same | | `edit()` |
| `POST /api/task/:id/assign` W | `{ assignee\|null }` | `{ assignee }` | 200 | `issue.assign` |
| `POST /api/task/:id/labels` W | `{ add:[], remove:[], force? }` | `{ labels }` | 200 / 400 (exclusive group clash without force) | `issue.labels` |
| `POST /api/task/:id/type` W | `{ type }` | `{ type }` | 200 / 400 | `issue.setType` |
| `POST /api/task/:id/priority` W | `{ priority }` | `{ priority }` | 200 / 400 | `issue.prioritise` |
| `POST /api/task/:id/estimate` W | `{ estimate:number }` | `{ estimate }` | 200 / 400 | `issue.estimate` |
| `POST /api/task/:id/comment` W | `{ text, author? }` | `{ comments:[{author,ts,text}] }` | 200 / 400 | `issue.addComment` (append-only) |
| `POST /api/task/:id/link` W | `{ type, to, remove? }` | `{ links:[{type,id}] }` (both ends written) | 200 / 400 unknown type | `issue.addLink` / `removeLink` |
| `POST /api/task/:id/unlink` W | `{ type, to }` | `{ links }` | 200 | `issue.removeLink` |
| `POST /api/task/:id/subtask` W | `{ parent\|null }` | `{ parent }` | 200 / 400 cycle | `issue.subtasks` |
| `POST /api/task/:id/dep` W | `{ add:[], remove:[] }` | `{ blockedBy }` | 200 / 400 cycle or dangling | `issue.dependencies` |
| `POST /api/task/:id/rank` W | `{ before?\|after?\|to? }` | `{ rank }` | 200 / 400 | `issue.rank` |
| `POST /api/task/:id/ac` W | `{ text }` | `{ acceptance:[{text,done,at?}] }` | 200 / 400 | `store.update` |
| `POST /api/task/:id/accept` W | `{ index (1-based), done=true, remove? }` | `{ acceptance, removed? }` | 200 / 400 bad index | `store.setCriterion` / `removeCriterion` |
| `POST /api/task/:id/evidence` W | JSON `{ text }` \| `{ path }` \| `{ filename, buffer\|content }` \| `{ detach }` — or `multipart/form-data` (field `file`) | `{ attached, evidence }` or `{ evidence }` | 200 / 400 / 404 / 413 | `evidence.attachEvidence` / `detachEvidence` |
| `POST /api/task/:id/sprint` W | `{ sprint\|null }` | `{ id, sprint }` | 200 / 400 / 404 no such sprint | `store.update`, logs `sprint` |
| `POST /api/task/:id/worktree` G | `{ action:"create"\|"remove", force? }` | `{ id, worktree, branch, shared }` / `{ id, worktree:null, removed, … }` | 200 / 400 / 409 dirty without force | `worktree.createWorktree` / `removeWorktree`; shared `worktree.provision` |
| `POST /api/task/:id/claim` G | `{ steal? }` | `{ id, claim:{session,actor,worktree,branch,pid,ts}, stolenFrom? }` — claim only, **no status change** | 200 / 409 naming the holder | `claims.claimTask` (`lib/claims.mjs:34`) + stamp |
| `POST /api/task/:id/release` W | — | `{ id, released:bool }` | 200 | `claims.releaseClaim` (`:76`) |
| `POST /api/task/:id/delete` W | `{ why? }` | `{ id, status:"deleted" }` (file kept, claim released) | 200 / 409 claimed by another live session | `store.update`, `release`, `logEvent("deleted")` |
| `POST /api/task/:id/restore` W | — | `{ id, status }` — returns to `deletedFrom` (never `done`), else `open` | 200 | `store.update`, logs `reopened {from:"deleted"}` |
| `POST /api/task/:id/dispatch` G (async, via `handleAsync`) | `{ backend?, steal? }` | `{ ok, id, backend, run, worktree, branch, detail? }` — claim + start + worktree + spawn in one call | 200 / 404 / 409 `gateStart` (WIP), claim held, or no backend available — the refusal carries the CLI's wording | `dispatch/index.mjs dispatch` (same as `tm dispatch` / `tm_dispatch`) |
| `POST /api/task/:id/collect` W (async, via `handleAsync`) | — | `{ ok, outcome?, downgraded?, parked? }` or `{ ok, pending:true }` while the worker runs | 200 / 404 / 409 never dispatched or no collector for the backend | `dispatch/collect.mjs collect` → `recordResult` (same as `tm collect` / `tm_collect`) |
| `GET /api/task/:id/touches` R | — | `{ id, touches:[paths] }` | 200 | task field |
| `POST /api/task/:id/touches` W | `{ add:[paths] }` | `{ touches }` | 200 | `touches.record` |
| `POST /api/bulk` W | `{ ids:[], op, args }` | `{ ok:[ids], failed:[{id,error}] }` — partial success | 200 / 400 | dispatches `POST /api/task/:id/<op>` per id |

### 2.4 Epics

| Method · Path | Body | Response | Codes | Source |
|---|---|---|---|---|
| `GET /api/epic/:id` R | — | full epic incl. `body`, `plan?` | 200 / 400 / 404 | `store.read` |
| `POST /api/epic` W/G | `{ id }` activate (`null`/`""` clears) **or** `{ title, body? }` create+activate | `{ activeEpic }` / 201 `{ id, title, activeEpic }` | 200 / 201 / 400 / 404 / 409 epic is done | `store.writeState`, `create`, logs `epic_active` |
| `POST /api/epic/:id/close` W | — | epic record | 200 / 409 already done | `store.update` |
| `POST /api/epic/:id/reopen` W | — | epic record | 200 / 409 not done | `store.reopenEpic` |
| `POST /api/epic/:id/plan` W | `{ plan: path\|null }` | epic record | 200 / 400 | `store.update` |
| `PATCH /api/epic/:id` W | `{ title?, body? }` | epic record (file name kept on retitle) | 200 / 400 | `store.editTask` (kind-agnostic; alias `editEntity`) |

### 2.5 ADRs

| Method · Path | Body | Response | Codes | Source |
|---|---|---|---|---|
| `GET /api/adr/:id` R | — | full ADR | 200 / 400 / 404 | |
| `POST /api/adr` W | `{ title, body? }` | 201 `{ id, title, status:"proposed", epic }` | 201 / 400 | `store.create` (epic from active pointer, `deciders:[]`, `date`) |
| `POST /api/adr/:id/accept` W | — | ADR record | 200 / 409 unless proposed | `store.update` |
| `POST /api/adr/:id/supersede` W | `{ title, body? }` | 201 `{ id, title, status, supersedes }` (old marked superseded) | 201 / 400 / 409 already superseded | `store.create`+`update` |
| `PATCH /api/adr/:id` W | `{ title?, body?, deciders?:string[] }` | ADR record | 200 / 400 deciders not string[] | `store.editTask` + `update` |

### 2.6 Sprints

| Method · Path | Body | Response | Codes | Source |
|---|---|---|---|---|
| `GET /api/sprint/:id` R | — | sprint + `report:{cards,committed,done,unsized}` | 200 / 400 / 404 | `render.sprintCounts` |
| `POST /api/sprint` W | `{ id }` activate (`null` clears) **or** `{ title, ends? }` create+activate | `{ activeSprint }` / 201 `{ id, title, activeSprint, ends }` | 200 / 201 / 400 / 404 | `store.create`, `writeState`, logs `sprint` |
| `POST /api/sprint/:id/done` W | — | sprint + `{ unfinished:n }` | 200 / 409 already done | `store.update` |
| `PATCH /api/sprint/:id` W | `{ title?, ends?:"YYYY-MM-DD"\|null, body? }` | sprint + report | 200 / 400 bad `ends` | `store.editTask` + `update` |

### 2.7 Capabilities

| Method · Path | Body | Response | Codes | Source |
|---|---|---|---|---|
| `GET /api/capability/:id` R | — | cap + derived `score` (1–27) | 200 / 400 / 404 | `capability.score` |
| `POST /api/capability` W | `{ title, area?, impact?, effort?, confidence?, source?, problem?, current?, proposal?, criteria?:[], nonGoals?:[] }` | 201 `{ id, title, status, area, impact, effort, confidence, score }` | 201 / 400 bad level | `capability.propose` |
| `POST /api/capability/:id/accept` W | — | `{ id, task, existing, status }` (mints the task) | 200 / 400 / 404 | `capability.accept` |
| `POST /api/capability/:id/ship` G | `{ evidence?, task? }` | `{ id, status, shipped }` | 200 / 409 "no evidence" | `capability.ship` |
| `POST /api/capability/:id/drop` W | `{ why? }` | `{ id, status, droppedReason }` | 200 | `capability.drop` |
| `PATCH /api/capability/:id` W | `{ title?, body?, area?, impact?, effort?, confidence?, source? }` | cap + score | 200 / 400 (`assertLevel`) | `store.editTask` + `update` |

### 2.8 Plans, worktrees, sessions, claims

| Method · Path | Query / body | Response | Codes | Source |
|---|---|---|---|---|
| `GET /api/plans` R | — | `[{ path, name, linkedEpic?, exists }]` (derived readdir) | 200 | `plans.listPlans` |
| `GET /api/plans/file` R | `ref=` | `{ ref, name, content? \| manifest? }` confined to `p.plans` unless it is an `epic.plan` | 200 / 404 | `plans.readPlanFile` |
| `GET /api/worktrees` R | — | `[{ path, branch, taskId, dirty, ahead, exists }]` (`[]` when none; never file contents) | 200 | `worktree.listWorktrees` |
| `GET /api/claims` R | — | `{ claims:{<id>:{session,actor,worktree,branch,pid,ts}}, stale:[ids], wipLimit, inProgress }` | 200 | `store.state`, `claims.staleClaims` (`:88`) |
| `POST /api/claims/sweep` W | `{ confirm:true }` | `{ released:[ids] }` | 200 / 400 without confirm | `claims.sweepClaims` (`:95`) |
| `GET /api/sessions` R | — | `{ harness:"claude"\|"codex"\|"grok"\|"kimi"\|null, sessions:[{ session, actor, tasks:[ids], worktree, branch, ts, live }] }` grouped from claims; `live = !expired(claim)` | 200 | `harness/sessions.currentHarness`, `claims.expired` |
| `GET /api/caps` R | — | the `detectHostCaps()` report: `{ backends:{topology,orchestration,tmux,manual}, clis, sandbox }` — what this host can dispatch work to (`tm caps` as JSON) | 200 | `hostcaps.detectHostCaps` |
| `GET /api/agents` R | — | `{ agents:[{ name, harness, backend, runId, pid, session, registeredAt, heartbeatAt, status, alive }] }` — the dispatched-worker registry, liveness derived | 200 | `agents.listAgents` |
| `GET /api/parallel` R | `epic` | `{ batches:[{ tasks:[ids], touches:[paths] }] }` | 200 | new `lib/parallel.mjs batches` (lifted from `bin/tm:1139-1157`) |
| `GET /api/stale` R | — | `{ minutes, tasks:[ids] }` | 200 | `store.staleTasks` (`lib/store.mjs:1311`), `config.staleMinutes` |

### 2.9 Insight, search, health, gates

| Method · Path | Query / body | Response | Codes | Source |
|---|---|---|---|---|
| `GET /api/graph` R | `epic`, `all=1`, `subtasks=0` | `{ nodes, edges, activeEpic, mermaid, counts:{tasks,edges} }` | 200 | `graph.graphData` (`lib/graph.mjs:250`), `graph.mermaid` (`:220`) |
| `GET /api/standup` R | `since=<iso>` (default now−24h) | `{ since, text }` (markdown) | 200 / 400 bad since | `render.standup` (`lib/render.mjs:312`) |
| `GET /api/time` R | — | `{ completed, medianMs, meanMs, median, mean, wip:[…], oldestOpen, throughput:{byDay,total,perDay} }` | 200 | `time.summary` (`lib/time.mjs:116`), `throughput` (`:96`) |
| `GET /api/find` R | `q=` (whitespace-tokenised; `field:value`, leading `-` negates, bare words = substring over title/body) | `{ query:<describeQuery>, hits:[{ id, kind, title, status, epic, labels, priority, assignee }] }` over epic/task/adr/capability/sprint | 200 / 400 unknown field, message lists `FIELD_NAMES` | `query.parseQuery/matchesQuery/describeQuery` (`lib/query.mjs`) |
| `GET /api/doctor` R | — | `{ findings:[{ level:"error"\|"warning", code, id, message, fixable }], errors, warnings, fixable, text }` (fix closures stripped) | 200 | `doctor.diagnose` (`lib/doctor.mjs:99`), `render` (`:753`) |
| `POST /api/doctor/fix` G | `{ confirm:true }` | `{ applied:[{ code, id, did\|error }], findings:<fresh diagnose> }` | 200 / 400 without confirm | `doctor.repairAll` (`:724`), logs `doctor_fix` |
| `POST /api/reindex` W | — | `{ epics, tasks, adrs, sprints, capabilities }` counts | 200 | `store.reindex` |
| `GET /api/override` R | — | `{ override:{reason,ts}\|null, enforce:bool }` | 200 | `store.state`, `enforce.enforcementOff` |
| `POST /api/override` W | `{ reason }` | `{ override:{reason,ts} }` — one-shot token consumed by the next gate on any surface | 200 / 400 empty reason | `enforce.setOverride` (`lib/enforce.mjs:20`) |
| `GET /api/ntfy` R | — | `{ config:{enabled,server,topic,minIntervalSeconds,boardUrl,categories}, hasToken, catalog:CATALOG }` (token never returned) | 200 | `ntfy.ntfyConfig` (`lib/ntfy.mjs:119`), `CATALOG` (`:28`) |
| `POST /api/ntfy/test` W (async) | `{ event?:"stop_gate_blocked" }` | `{ sent, status?, error?, reason? }` — `reason` is `shouldPublish`'s explanation when it declines | 200 | `ntfy.shouldPublish/messageFor/send`; token env-only (`TM_NTFY_TOKEN`) |
| `GET /api/planner` | — | `{ sessions:[{id,created,updated,status,goal,epic,turns,attachments}] }` newest first | 200 | `lib/planner.mjs` |
| `GET /api/planner/:id` | — | the whole session: goal, turns, attachments, proposal | 200 / 400 not a session id / 404 | `PL-` + 12 hex, checked before it becomes a path |
| `POST /api/planner` | `{ goal, epic? }` | 201 the new session | 201 / 400 empty or over-long goal | one bounded outcome, not a document |
| `POST /api/planner/:id/turn` | `{ role, kind, text, payload? }` | the updated session | 200 / 400 unknown kind / 409 session not open | `kind` is from a fixed set — agent prose cannot invent a slot |
| `POST /api/planner/:id/close` | `{ status: applied\|cancelled\|rejected }` | the closed session | 200 / 400 unknown status | a closed session takes no more turns or attachments |
| `DELETE /api/planner/:id` | — | `{ id, deleted:true }` | 200 / 404 | removes the attachments with it |
| `GET /api/planner/agents` | — | `{ agents:[{id,label,connected,session,boardWrites,capabilities}] }` | 200 | Operator-configured trusted ACP agents from `config.planner.agents`. **Never carries the command line** — a page that could read it could read whatever secret is in it. |
| `POST /api/planner/agents/:id/probe` | — | the same shape, `connected` measured | 200 / 404 unknown agent | Actually spawns and initializes. A check that only reads configuration reports healthy for a command that is not installed. |
| `POST /api/planner/:id/run` | `{ agent }` | 202 `{ runId, agent }` | 202 / 400 unknown agent or none selected / 409 already running, or the session is not open | Starts an ACP session and streams AG-UI events. One run per session: two agents prompting into one conversation would interleave their questions. |
| `GET /api/planner/:id/run` | — | `{ running, runId, agent, events, error }` | 200 | Runs are in memory — a run is a live process and cannot outlive the server. The *session* is what a reload resumes from. |
| `GET /api/planner/:id/stream` | — | SSE of AG-UI events for the live run | 200 | Push, not poll. Replays what already happened before attaching, so a late browser still gets the whole trace. Emits `tm.run.absent` and closes when no run is in flight. |
| `POST /api/planner/:id/cancel` | — | `{ cancelled, runId }` | 200 | Sends ACP `session/cancel` first, so the agent hears about it. |
| `POST /api/planner/:id/attachment` | `multipart/form-data` with one `file` | 201 `{ attached, attachments }` | 201 / 400 type, size, count or content refusal / 409 session not open | Content-addressed: the supplied name never reaches the filesystem. Text and image allowlist, magic-byte check, per-file/session/count bounds, sha256 dedupe, `trust: untrusted-session-context`. |
| `GET /api/planner/:id/attachment/:sha256` | — | the bytes | 200 / 404 fails closed | Always `Content-Disposition: attachment` plus a `sandbox` CSP and `nosniff`: these bytes came from outside and must not borrow the dashboard's origin. |
| `POST /api/planner/:id/propose` | `{ operations:[{op,args}] }` | `{ digest, ok, operations:[{index,op,summary,consequence,args,valid,refusal}] }` | 200 / 400 ungoverned op / 409 session not open | `lib/planner-ops.mjs` — allowlist of `epic.create`, `epic.activate`, `task.create`, `task.depends`. Writes nothing; the proposal is stored on the session. |
| `POST /api/planner/:id/apply` G | `{ approvedDigest }` | 201 `{ digest, applied:[], created:[ids] }` | 201 / 409 digest mismatch, no proposal, or a store refusal | Lands atomically through the store's own functions and gates; rolls back whole on failure and closes the session `applied`. |
| `POST /api/goal/preview` | same body as `/api/goal/import` | doc: `{ kind:"doc", title, criteria:[], shape, doc?, epic }`; manifest: `{ kind:"manifest", doc, epic:{title,plan}, goals:[{goalId,title,criteria,goalDoc,touches,labels,dependsOn}], skipped, edges, danglingDeps }` | 200 / 400 path escape / 404 / 409 same refusal as import | `planManifest` — the import's own first half, so a preview cannot disagree with the apply. Writes nothing. |
| `POST /api/goal/import` G | `{ path }` (repo-relative or absolute `.md` / `.plan.json`, confined to `p.root`) **or** `{ content, name }` | doc: 201 `{ id, title, epic, criteria }`; manifest: 201 `{ epic, tasks:[ids], skipped:[{id,why}], edges }` | 201 / 400 path escape / 409 `goals.refusal()` text or `gateTaskCreate` | new `lib/goal-import.mjs importGoalDoc/importManifest` (lifted from `bin/tm:272-316`, `:1309-1409`) |

## 3. `GET /api/board` payload

```
{
  epics:        Epic[]        (body stripped)
  tasks:        Task[]        (body stripped, + hasAnswer)
  adrs:         Adr[]
  sprints:      Sprint[]      (+ report)
  capabilities: Capability[]  (ranked, + score)
  backlog:      string[]      (task ids in rank order)
  state:        { activeEpic, activeSprint, claims, override, lastStopBlock }
  settings:     config.board  ({ launchBrowser, grouped, me, categories, watching, views })
  actor:        string
  project:      string
  labelCatalog: string[]
}
```
Entities whose `board` differs from `storeBoard(p)` are filtered out (foreign entities are never drawn).
The server sets `ETag` (index.json mtime+size); `If-None-Match` → **304**.

## 4. `GET /api/meta`

```jsonc
{
  "plugin":  { "version": "<serverVersion() — manifest version | install SHA | git SHA>", "root": "/…/task-management" },
  "store":   { "root": "/repo", "base": "/repo/.bytedesk/task-management", "boardId": "owner/repo", "owner": "…", "project": "Bytedesk Marketplace" },
  "harness": "claude" | "codex" | "grok" | "kimi" | null,
  "actor":   "main",
  "session": "<id>" | null,
  "vocab": {
    "columns":     ["backlog","open","in_progress","blocked","parked","done"],          // lib/render.mjs COLUMNS
    "labels":      { "backlog":"backlog","open":"todo","in_progress":"in progress","blocked":"blocked","parked":"parked","done":"done" }, // LABEL
    "priorities":  ["highest","high","medium","low","lowest"],                          // lib/store.mjs PRIORITIES
    "types":       ["task","bug","story","spike","chore"],                               // lib/issue.mjs TYPES
    "linkTypes":   { "blocks":"blocked by","blocked by":"blocks","causes":"caused by","caused by":"causes","duplicates":"duplicated by","duplicated by":"duplicates","relates to":"relates to" },
    "adrStatuses": ["proposed","accepted","superseded"],
    "capLevels":   ["H","M","L"], "capEfforts": ["S","M","L"],                           // lib/capability.mjs
    "findFields":  ["status","epic","assignee","actor","priority","type","label","kind","id","goal","sprint"], // lib/query.mjs FIELD_NAMES
    "eventCatalog": { "<event>": { "label", "priority", "tags", "group":"recommended|writes|noise" } },  // lib/ntfy.mjs CATALOG.events
    "exportFormats": ["md","csv","json"],
    "labelCatalog": ["decision:map","decision:interview","decision:research","decision:prototype","decision:unblock","needs-triage","needs-info","ready-for-agent","ready-for-human","wontfix", …configured]
  },
  "settings": <settingsSnapshot(p)>,
  "config":   <config(p)>,            // read-only display
  "gates":    { "enforce": true, "override": null }
}
```
`serverVersion` is exported from `lib/mcp.mjs` (currently module-private). The SPA fetches
`/api/meta` once at boot and derives every select/filter vocabulary from it; the hand mirror of
`FIELD_NAMES` in `dashboard/src/filters.ts` and its pin in `tests/unit/query.test.mjs` go away.

## 5. SSE `/events`

Frames:

```
event: ready
data: {"offset":<bytes>,"project":"…"}

id: <byte offset of the end of this line in events.jsonl>
event: store
data: <the raw JSONL row: {ts,event,session,actor,id?,…}>

event: resync
data: {"reason":"rotated"}

: ping                     ← every 25 s
```

- `id:` is the byte offset in the current `events.jsonl` generation; monotonic within a
  generation; nothing is persisted for it.
- `Last-Event-ID` on connect: parsed as an integer and clamped to `[0, size]`. If `< size` the
  server replays `[id, size)` as `store` frames before subscribing. If `> size` (rotation) it
  sends `resync` and the client does one full `GET /api/board`. `tail()` also broadcasts `resync`
  when it detects truncation (`size < offset`).
- The client applies `store` frames incrementally: per-entity kinds → debounced
  `GET /api/entity/:id`; structural kinds and unknown kinds → debounced `GET /api/board`.
  Never refetch the whole board per frame.
- `/api/task/:id/stream` is unchanged (`data:` only, 2 s poll, dedup).

## 6. MCP parity (closes CAP-0001)

New tools in `lib/mcp.mjs TOOLS`, each delegating to the same lib function the route uses:

| Tool | Input schema |
|---|---|
| `tm_worktree` | `{ action:"new"\|"rm"\|"list", id?, base?, share?:bool, force?:bool, steal?:bool }` → `worktree.provision` / `removeWorktree` / `listWorktrees` |
| `tm_link` | `{ id, type (key of LINK_TYPES), to, remove?:bool }` |
| `tm_graph` | `{ epic?, all?:bool, subtasks?:bool }` → `{ nodes, edges, mermaid }` |
| `tm_doctor` | `{ fix?:bool }` → `{ findings, applied? }` |
| `tm_export` | `{ format, epic?, status?, open?:bool, events?:bool }` → `{ format, text }` (clamped to 64 000 chars) |
| `tm_time` | `{ id? }` → summary or per-task `{ cycle, inStatus, timeline }` |
| `tm_parallel` | `{ epic? }` → `{ batches }` |
| `tm_task_field` | `{ id, assignee?, priority?, estimate?, type?, rank?:{before?,after?,to?}, parent?, dep?:{add?,remove?}, comment?, touches?:string[] }` — one field set per call |
| `tm_history` | `{ id, limit? }` → `{ events, text }` |
| `tm_stale` | `{}` → `{ minutes, tasks }` |
| `tm_goal_import` | `{ path }` → same shape as the route |
| `tm_task_update` | gains `action: "delete" \| "restore"` |
| `tm_dispatch` (async) | `{ id, backend?, steal?:bool }` — the same `dispatch()` as `POST /api/task/:id/dispatch` and `tm dispatch`; `gateStart` binds here exactly as on the CLI |
| `tm_collect` (async) | `{ id }` → the collector's `{ outcome, downgraded, parked }` or `{ pending:true }` — same as `POST /api/task/:id/collect` |
| `tm_agents` | `{ action?:"list"\|"heartbeat"\|"reap", name? }` → the worker registry; `reap` also parks the board behind dead workers |

Existing tools (unchanged): `tm_board, tm_next, tm_show, tm_find, tm_why, tm_log, tm_standup, tm_epic,
tm_task_create, tm_task_update, tm_task_edit, tm_ac_add, tm_ac_accept, tm_evidence, tm_adr_new,
tm_cap_propose, tm_cap_list, tm_cap_accept, tm_cap_ship, tm_cap_drop, tm_sprint, tm_handoff, tm_claim, tm_label`.

The server now advertises **38 tools** (24 existing + 11 parity + 3 agent-first) — verified
against `tools/list`, not counted by hand.

## 7. Settings catalog additions (`lib/settings.mjs CATALOG`)

Existing writable keys: `board.launchBrowser, board.grouped, board.me, enforce, requireEpic,
requireAcceptance, wipLimit, autoCloseEpics, gitLink, parkOnSessionEnd, trackTouches,
staleMinutes, claimTtlMinutes, captureDecisions, ntfy.enabled, ntfy.server, ntfy.topic,
ntfy.minIntervalSeconds, ntfy.boardUrl`; read-only: `boardId, owner`.

Added since (group `workflow` unless noted): `eventMaxBytes` (integer), `branchPrefix` (string),
`worktreeDir` (string), `worktreeShare` (json: `[{path, mode:"symlink"|"copy"|"hardlink"}]`),
`ntfy.categories` (json, group `ntfy`: the event kinds `tm ntfy on <kind>` opts into — the board's
per-kind toggles write this list).
The ntfy token stays env-only (`TM_NTFY_TOKEN`) and is never writable or returned.

Agent-first wave (group `agents`): `dispatch.enabled` (boolean), `dispatch.poolWip` (integer),
`dispatch.pollSeconds` (integer), `dispatch.heartbeatSeconds` (integer), `agentTtlMinutes`
(integer). `dispatch.backends` and `dispatch.backendCaps` stay `tm config`-only (arrays/objects,
not catalog scalars), as do `webhooks`/`webhooksAllowRemote`.

Completeness gates (group `policy`, all `json` field lists drawn from `lib/completeness.mjs` —
`"body"`, `"acceptance"`, `"evidence"`, `"actor"`): `requireOnCreate` (default
`["body","acceptance"]`; binds explicit CLI/MCP/HTTP creates, harness mirrors exempt),
`requireOnStart` (default `["body","acceptance"]`; binds start and dispatch on every surface),
`requireOnDone` (default `["body","acceptance","evidence","actor"]`; on top of
`requireAcceptance`, so a task with no criteria at all can no longer close).

## 8. Shared-gate changes the backend worker makes

- `enforce.gateStart(id, p)` → `{ allow, reason }`: the WIP check (+ override consumption) used by
  `bin/tm start`, `tm_task_update start`/`tm_claim`, and `transition(in_progress)` — which today
  has **no WIP check** (`lib/dashboard-api.mjs:341`).
- `stamp()` moves to `lib/actor.mjs`; `bin/tm` and `dashboard-api` share it.
- `worktree.provision(task, opts, p)` lifted from `bin/tm:1183-1207` (claim + update + event).
- New event kind `deleted` added to `CATALOG.events.writes` (`lib/ntfy.mjs`) **and** the
  `tests/unit/log-render.test.mjs` fixture (the three-place rule).

## 9. Non-goals (explicit)

- **Comment edit/delete is unsupported.** Comments are `{author, ts, text}` with no id
  (`lib/issue.mjs addComment`); the UI says "append-only, like `tm comment`".
- **No `POST /api/config`.** Gates are written through the settings allowlist; the full config is
  read-only in `/api/meta.config`. `tm config` remains the CLI path for anything else.
- **Export is served as computed text only**; `--out` has no HTTP equivalent; no file path is
  ever accepted or served outside `evidence/` and `plans/`.
- **No new file-serving routes.** `/api/task/:id/file` and `/api/plans/file` confinement stands.
- **No `subscribe`/`listChanged` over MCP** (resources render live at read time).
