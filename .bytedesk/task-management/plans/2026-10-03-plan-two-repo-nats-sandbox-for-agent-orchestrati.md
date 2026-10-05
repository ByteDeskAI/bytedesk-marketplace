# Plan: two-repo NATS sandbox for agent-orchestration (AO) messaging and automation

## Context

AO sends mail over NATS JetStream and uses tmux only as a doorbell (`topology/lib/mailbox.mjs`, `delivery.mjs`, `orch-transport.mjs`). Much of the NATS surface is built but unused, and nothing is event-driven:

- **Unused methods:** `publishReady`/`pullReady` (the `ORCH_TASKS` work queue), `putAgent`/`getAgent`, `putReview`/`getReview`, `compareAndSetClaim`, `getPresence`.
- **No KV watch.** Consumers poll (`waitForReplies` sleeps 3 s).
- **No event stream.** Journals are files only.
- **Local fallback uses one shared user** (`nats-local.mjs:47`). Per-agent creds exist only via the gateway (`AO_ORCH_CREDS`).

OpenRig (github.com/mvschwarz/openrig) gives patterns worth borrowing, not a design to copy. It uses a single-host SQLite daemon with tmux paste as transport. We keep NATS as the source of truth. Findings are from docs only; its source was not read.

Goal: prove three capabilities in disposable repos before touching the plugin, then turn the results into tracked tasks. Everything stays an integrated remote-gateway plugin: new subjects go through `ORCH_LAYOUT`, the transport object and the `ao-topology` CLI.

## Phase 0: sandbox (nothing in real repos changes)

Location: the session scratchpad, `…/scratchpad/ao-sandbox/`.

1. `repo-a/` and `repo-b/`: `git init`, one commit each. Each gets its own `AGENT_ORCHESTRATION_STATE_HOME` and `XDG_CONFIG_HOME` under the sandbox.
2. One shared `nats-server`, started on a random loopback port with `AO_NATS_HOME` set to a sandbox dir, using the `natsServerBin` pattern from `tests/unit/orch-transport.test.mjs:55-93`. Both repos use `AO_NATS_URL` and leave `AO_TRANSPORT` unset. Different repos get disjoint `orch.<repo>.*` subjects via `repoKey`.
3. tmux isolation, all three, per `.claude/rules/tmux-test-isolation.md`: `TMUX=''`, a per-run `TMUX_TMPDIR`, and every `kill-server`/`kill-session` scoped with `-L <unique name>`. Never touch the default server.
4. A `sandbox.sh` that sets this env, creates one lead or worker agent per repo (`ao-topology agent new`), and tears everything down with scoped kills.
5. Baseline: send A→B and B→A with `ao-topology send` and `wait`. Capture the journal and NATS stream state to confirm the existing path works before experimenting.

## Phase 1: cross-repo handoff with a closure contract

Borrowed from OpenRig's closure rule: a work item cannot finish without a reason, and some reasons name a target.

- Add a small handoff envelope on top of the existing mail path (`sendMessage`, `standing-mailbox.mjs`): the message id doubles as the dedupe key (`Nats-Msg-Id` is already used, 120 s window).
- Closure reasons: `handed_off_to`, `blocked_on`, `denied`, `canceled`, `no-follow-on`, `escalation`. The first three require a target.
- Create the successor message first, then close the source, so a crash causes a retry rather than a loss.
- Record the closure in a KV bucket (`ORCH_AGENTS` is defined and unused; reuse it or add a sibling bucket via `ORCH_LAYOUT`).
- Reuse the delegation and hop-limit checks already in `sendMessage` and `routeMessage`. Do not add a parallel auth path.
- Prototype as a script in the sandbox first; do not edit `agent-orchestration/` yet.

## Phase 2: event stream and KV watch

- Add an `ORCH_EVENTS` stream (subject `orch.<repo>.events.>`, limits retention) that mirrors each journal event (`message.sent`, `message.replied`, `message.undelivered`, `wait.*`). Journal files stay the record of truth.
- Replace polling in `waitForReplies` with a durable consumer or a KV watch on replies and presence (`js.kv.watch`). Keep a poll fallback.
- Add OpenRig's computed diagnoses as read-side views over the stream, never stored: `PARKED` (idle with pending mail), `DONE-UNSEEN` (replied but never read).
- Constraint: the NATS grants the gateway issues cover `orch.<repo>.{mail,tasks,presence,claims,probe}.>` only. The new events subject needs a gateway-side grant, so list that as a dependency, not something the plugin can assume.

## Phase 3: work queue on the unused tasks stream

- Drive `ORCH_TASKS` (`orch.<repo>.tasks.ready`, durable `tasks_<repo>`): idle agents pull ready work and take it with `compareAndSetClaim` on `ORCH_CLAIMS`. A lost race ends in a NAK and retry.
- Test two workers racing for one item, and a worker dying mid-claim (claim expiry).
- Prototype alongside, never inside, task-management. The two plugins must stay independent (KM note: task-management and agent-orchestration stay independent).

## Phase 4: skills layer and write-up

- One skill per capability, driven through `ao-topology` verbs only (same pattern as `skills/orchestration-*/SKILL.md`; none call NATS directly).
- Where a feature works, add the matching method to `createFileTransport` so the file double stays in step.
- Output: a findings doc, then one `tm` task per adopted feature (with acceptance criteria) under the active epic. Implementation happens later in a worktree, with `agent-orchestration` CHANGELOG and its own ecosystem semver markers only. No Claude-side `version` is ever added.

## Verification

- Phase 0 baseline: `send` from A delivers to B; the `wait` in A returns B's reply; journals show `message.sent`, `message.replied`, `wait.satisfied`.
- Each phase has a script that fails when the behaviour is absent. Print the raw value, not a count: for dedupe, publish the same id twice and print the stream message count; for claims, print the winning agent id from two racers.
- Each result reports the commit and dirty state of the tree it measured, and names what the sandbox removed (shared state home, the real gateway, per-agent creds).
- Live tmux check: ring a real pane in the isolated server and read the composer output; a unit stub alone does not count.
- Final run: `node --test --test-concurrency=1` in `agent-orchestration` is unchanged and green, since no plugin file is edited before Phase 4.
- Teardown: confirm `tmux -L <name> ls` fails (server gone), the sandbox `nats-server` pid is dead, and `tmux ls` on the default server still lists the operator's sessions.

## Out of scope

- Per-agent NATS creds (needs the gateway's `IssueOrch`; noted as a dependency).
- Copying OpenRig's SQLite daemon, edge kinds or typing guards.
- Any edit under `agent-orchestration/` until Phase 4 produces tracked tasks.
