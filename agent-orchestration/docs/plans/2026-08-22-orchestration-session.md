# Agent Orchestration Session

Date: 2026-08-22  
Status: Phase 4 done. Session host is a Linux/WSL `systemd-run --user --scope` process per state root (in-process fallback; native Windows in-process).  
Plugin: `agent-orchestration@bytedesk`

This is the operator window for **one broker run**. When `orchestration_spawn` starts a run, a
loopback web server for that run is already the intended surface: print the URL on the host
terminal, open a browser, and keep conversation, handoffs, tool activity, approvals, and controls
on one page.

Dogfood used to produce this plan:

| Artifact | Run | Intent | Profile |
|---|---|---|---|
| UI spec | `run_e4b06416-b931-4064-977d-9f828136cb4d` | design | read |
| Architecture proposal (critique still running) | `run_919e54fd-5ef7-4ad5-87fe-2a28c4839092` | architecture | read |
| Mockup | `session-ui/mockup/` | — | — |

The proposal stage of `run_919e54fd` is complete (Claude Fable). Codex critique was in flight
when this file landed. Phase 1 must reconcile with the revision + gate before writing bind code.

The design spec lives in the mockup itself (layout, states, copy). This document is the
implementation contract against the **existing broker**, not a second product.

## What already exists

Do not invent a parallel event log.

- Durable snapshot: `{stateRoot}/runs/{runId}/snapshot.json`
- Hash-chained journal: `{stateRoot}/runs/{runId}/events.ndjson` (`seq`, `previousHash`, `hash`)
- Terminal states: `succeeded`, `failed`, `cancelled`, `timed_out`, `rejected`, `recovery_required`
- Operator-relevant non-terminal: `queued`, `preparing`, `running`, `verifying`, `cancelling`, `waiting_for_decision`, `cleanup_required`
- MCP already exposes `orchestration_events`, `orchestration_status`, `orchestration_send`, `orchestration_cancel`, `orchestration_decision_get`, `orchestration_decision_approve`
- Provider isolation is Bubblewrap + `slirp4netns` with **host loopback disabled**
- Follow-up (`orchestration_send`) is fail-closed: parent must be `permissionProfile: read` and persistent; writable follow-up requires a new run

The session UI is a **projection and control plane** over that store. It does not become another
source of truth.

## Product shape

One session = one `runId`.

The page must answer, in under three seconds: *what is running, on what, under what permission
profile, and is it waiting on me?*

Regions (from the design run; mockup implements them):

1. Run header — id, intent, host, permission profile, workspace, global state, elapsed
2. Stage rail — protocol stages from `plan.stages`, never a hard-coded pipeline
3. Conversation — operator / host / delegated provider / broker events / handoff dividers / decision cards
4. Inspector — Activity, Approvals, Evidence
5. Composer / decision bar
6. Status bar — state, stage, provider, profile, last event, connection

Global UI states to render: `empty` (created, no stage started), `running`, `waiting_for_decision`,
`cancelling`, `failed`, `succeeded`, `cancelled`. Map broker `queued`/`preparing` → empty-or-starting;
`verifying` → running with stage label `verifying`; `timed_out`/`rejected`/`recovery_required` → failed
variants with the real `state` string on the pill.

## Architecture

### Process model

**Session HTTP lives outside Bubblewrap.** Hard constraint from the sandbox: `slirp4netns
--disable-host-loopback` already makes `127.0.0.1` unreachable from providers.

| Option | Verdict |
|---|---|
| HTTP inside the provider sandbox | Forbidden. |
| Child HTTP process per run | Extra process group per run. Proposal listed this as Option C; do not take it for v1. |
| In-broker multiplexed listener | Simpler. Dies when the host MCP process dies. |
| Session-host process per state root (`systemd-run --user --scope`, first-wins lock) | Proposal recommendation: survives host-session restart, outlives the worker for post-run review. |

**Shipped:** Linux/WSL uses a state-root session-host process (`systemd-run --user --scope`, first-wins
unit name + `lease.json` probe). MCP joins a live host and does not stop it on dispose. Native Windows
and `AGENT_ORCHESTRATION_SESSION_SUPERVISOR=0` stay in-process. URL/auth/event contracts are unchanged.

MCP stdout is JSON-RPC only (`src/mcp.mjs`). Hosts do not reliably show MCP stderr. The URL must
travel in the `orchestration_spawn` structured result (`session: { url, bind, opened }`) **and**
as a stderr diagnostic. The `agent-orchestrate` skill must echo the URL verbatim.

Per-run work is a **session binding** written next to the journal, not a second Node process:

```
{stateRoot}/runs/{runId}/session.json    # token hash, port echo, openedAt (mode 0600)
```

The raw token is never stored. Only `sha256(token)` is on disk. The URL printed to the terminal is
the only time the token is shown.

### URL scheme

```
http://127.0.0.1:{port}/s/{runId}/{token}
```

- Host: `127.0.0.1` only. Refuse `0.0.0.0`, `::`, or a public interface. `EADDRINUSE` walks a small
  port range (`48700–48732`) then fails closed with `AO_SESSION_BIND`.
- `runId`: broker-issued `run_*` UUID.
- `token`: 32 bytes, `base64url`. Possession of the URL is the capability.
- Query strings are not used for the token (shell copy is one path).
- No TLS on loopback for v1.

Spawn (and `orchestration_status`) include:

```json
"session": { "url": "http://127.0.0.1:48701/s/run_…/…", "bind": "127.0.0.1:48701" }
```

Stderr of the MCP process prints a single line the host CLI will surface:

```
Orchestration session: http://127.0.0.1:48701/s/run_…/…
```

Then `xdg-open` (Linux) the same URL. Open failure is non-fatal if the line was printed.

### Auth

1. Loopback bind is the network boundary.
2. Unforgeable path token is the capability. Constant-time compare of `sha256(presented)` to
   `session.json`.
3. Mutating `POST` also requires `Origin` to be `http://127.0.0.1:{port}` or absent (same-machine
   non-browser). Reject other origins.
4. Do not put the token in `snapshot.json` (MCP `orchestration_status` must not leak it to a
   different consumer). `session.url` is returned only to the spawn caller and later status calls
   that already passed `consumerCwd` ownership.
5. Token rotation is out of scope for v1. Cancel the run if the URL leaked on a shared machine.

### Event source

The browser does not read the journal file. The session server does.

```
GET  /s/:runId/:token/snapshot          → current snapshot.json (no session token fields)
GET  /s/:runId/:token/events?after=N    → SSE of events with seq > N, chain verified first
POST /s/:runId/:token/cancel            → OrchestrationService.cancel
POST /s/:runId/:token/follow-up         → OrchestrationService.send (same fail-closed rules)
POST /s/:runId/:token/decision          → OrchestrationService.decisionApprove
```

SSE algorithm:

1. `store.events(runId, after)` (already verifies the hash chain; corrupt log → 409 `AO_EVENT_LOG_CORRUPT`)
2. Write each event as `data: {json}\n\n`
3. `fs.watch` the run directory (or poll 250 ms if inotify is unavailable)
4. Heartbeat comment every 15 s so the status bar can distinguish `live` / `reconnecting` / `detached`

If the chain check fails, freeze the UI at the last good `seq` and set connection to `detached`.
Never skip a broken event.

**Projection** (server or client; v1 can be client-side from verified events + snapshot):

| Journal `type` | UI |
|---|---|
| `run_created` | empty conversation placeholder |
| `state_changed` / `decision_waiting_for_approval` | header pill, composer swap |
| `stage_completed` | handoff divider + delegated output |
| `provider_event` | activity row; `text_delta` later if we persist them |
| `cancel_requested` | cancelling pill |
| `route_fallback` | broker event in transcript |
| `workspace_removed` | evidence note |

Provider `text_delta` is currently **not** journaled (engine only stores `tool_call`/`status` into
`lastProviderEvent`). v1 conversation is therefore coarse: stage outputs + last provider event +
operator follow-ups. A follow-up journal type `operator_message` is required before the composer
is honest. Phase 2 may append `provider_text` events without changing the hash scheme.

### Bubblewrap relationship

```
[host terminal] ──MCP stdio──► [broker Node]
                                   ├── RunStore (stateRoot)
                                   ├── session HTTP 127.0.0.1  ← operator browser
                                   └── systemd-run worker
                                          └── bwrap + slirp4netns (loopback off)
                                                └── claude | codex | grok | kimi
```

The session server is an operator surface on the host. Sandboxed providers cannot connect to it.
Do not punch a hole through `slirp4netns` for “the agent to see the session.” If a provider needs
status, it already has MCP tools in the **host** session, not in the sandbox.

ACP `fs/*` and `terminal/*` on the broker remain deny-all. Session control is HTTP from the
operator, not ACP from the child.

### Controls vs MCP

The browser is not a second authorization principal. Token possession **plus** run ownership
already recorded on the snapshot is enough for cancel / approve on that run. `consumerCwd` is not
sent from the browser.

Follow-up keeps the current service invariant: writable persistent follow-up is disabled; the UI
disables Send on write-profile runs and on terminal runs (design choice: closed run → new spawn,
do not reopen). If `orchestration_send` throws `AO_WRITE_FOLLOWUP_REQUIRES_NEW_RUN`, show that
string in the composer error slot.

Cancel is two-step in the UI, one `POST /cancel` which is idempotent (`requestCancel`). Pill shows
`cancelling` until a terminal transition arrives on SSE.

## Phased implementation

### Phase 0 — mockup (this change)

Static Hallmark Cobalt workbench at `session-ui/mockup/`. `session-ui/serve.mjs` binds loopback,
prints `Orchestration session: <url>`, opens a browser. Fixture states cover empty / running /
waiting_for_decision / failed / succeeded / cancelled. No broker coupling.

### Phase 1 — bind, print, static shell

- `src/session-http.mjs`: listen `127.0.0.1`, serve the session UI assets, reject non-loopback.
- On `store.create`, mint token, write `session.json` (hash only), attach `session.bind`.
- Print URL on stderr; `xdg-open`; add `session.url` to spawn return (url only in-memory / spawn
  result, not snapshot).
- Tests: bind address, token compare, no token in snapshot, port walk, refuse `0.0.0.0`.

### Phase 2 — live snapshot + SSE

- Snapshot and events routes with chain verification.
- UI status bar `live` / `reconnecting` / `detached`.
- Stage rail driven by `plan.stages`.
- Tests: SSE after=N, corrupt journal 409, watch delivers seq+1.

### Phase 3 — conversation projection + controls

- Handoff dividers from `stage_completed` + next stage start.
- Activity table from `provider_event` / `route_fallback`.
- POST cancel / follow-up / decision through `OrchestrationService`.
- Persist `operator_message` events so follow-ups survive reload.
- Optional: journal `provider_text` chunks (size-capped) so streaming in C is real.

### Phase 4 — host skill + docs

- `agent-orchestrate` skill: after spawn, show the session URL before waiting.
- README: session is the operator window; MCP tools remain the agent API.

## Non-goals (v1)

- Multi-run dashboard
- Remote / LAN bind, TLS, SSO
- Rendering inside the provider sandbox
- Cost or token meters unless the journal actually contains them
- Reopening a terminal run from the composer

## Verification

- Unit: bind, token, origin check, event projection, no token leak in snapshot
- Manual: `node session-ui/serve.mjs` prints a URL; browser shows all six fixture states
- After Phase 1: spawn a read-only run from a host CLI, confirm the URL line, confirm the page
  tracks `orchestration_events` without a second log
- Never grep test output for `pass`; gate on the runner exit code

## Risks

- MCP stderr may be swallowed by a host; returning `session.url` on spawn is the reliable path
- `xdg-open` on a headless agent host does nothing; printing is enough
- Hash-chain verification on every SSE tick is CPU-cheap at current log sizes; if logs grow,
  verify incrementally from last good seq (store already does this per `after`)
- Decision cards in the mockup assume approve/reject + note; broker `decisionApprove` already
  matches that
- Architecture run `run_919e54fd` proposal prefers a state-root session-host process, a one-time
  capability URL exchanged for an HttpOnly cookie, and a new per-turn NDJSON stream anchored into
  the main journal. Critique/revision were not terminal when this plan shipped. Do not start Phase 1
  bind code until `orchestration_decision_get` returns a disposition, then fold those three items
  in or reject them with rationale.
