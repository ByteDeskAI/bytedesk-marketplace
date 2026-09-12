# Plan: automatic readiness and an always-on dispatch pool

## Context

### What `ready-for-agent` is today

- **What it means:** "a human finished specifying this and approves an agent taking it." It is one of five mutually exclusive
  triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) at
  `task-management/lib/issue.mjs:24-33`, added in commit `9d97fa2` (2026-08-25). Nothing records an outside source for the names.
- **Who applies it:** only people. No code sets it. The one skill that mentions it (`skills/tickets/SKILL.md:14`)
  adds it after the user approves the slices. `tm task new` has no `--label` flag. Nothing moves `needs-triage` to
  `ready-for-agent`, so the triage labels have no state machine.
- **What reads it:** `poolable()` at `lib/dispatch/pool.mjs:126-128` selects tasks that match all of these:
  - open (or dependency-blocked with no stated reason)
  - every dependency met
  - labelled `ready-for-agent`
  - not claimed

### Why the label is not applied when a task is created

1. **It was a deliberate choice.** `README.md:186-191` says: "the label is the human's go-ahead, and a loop that guessed at
   what to run would be deciding, which is the human's job." That reasoning is only in docs and code comments; there is
   no ADR.
2. **A new task is often not finished.** The tickets flow adds `blockedBy` after creation, and `touches` is observed from
   edits rather than declared (`lib/touches.mjs:1-20`).
3. **There is no readiness check.** The create and start gates check body and acceptance criteria. Nothing checks "an
   agent could do this without a conversation."

### Why the pool is off by default

- **The recorded reason:** "An autostarted daemon nobody asked for must not start dispatching work"
  (`pool.mjs:18-22`, commit `3ef5c22`). There is no ADR, and nothing mentions cost.
- **It cannot be turned on mid-session.** The monitor (`monitors/monitors.json`, `when: "always"`) runs
  `tm pool run --auto`. That command reads `dispatch.enabled` once and exits (`pool.mjs:257`). Monitors never restart, so
  turning the flag on does nothing until the next session.

### Why it is not safe to switch on as it stands (each verified by reading the code)

| # | Defect | Where |
|---|---|---|
| B1 | `tm config <key>` with no value **deletes** that key. This session's `tm config dispatch` did so, removing an empty `dispatch: {}`. | `bin/tm:1029-1030`, `lib/store.mjs:408-417` |
| B2 | The documented `tm config dispatch.enabled true` writes a literal top-level key, which the pool never reads. | same; docs at `skills/pool/SKILL.md:24`, `docs/agent-first.md:282`, `docs/use-cases.md:560` |
| B3 | Pool dispatch skips `gateStart`, so body and acceptance criteria are never checked. | `pool.mjs:227` vs `bin/tm:1317` |
| B4 | Capacity counts registry agents whose 30-minute heartbeat is never renewed for tmux or topology workers. After 30 minutes `poolWip` stops holding. | `pool.mjs:186-188`, `agents.mjs:139-145`, `index.mjs:63-76` |
| B5 | `tm pool stop` sent during a tick is lost, and the SIGTERM listener also removes the default exit. | `pool.mjs:268-292` |
| B6 | The touches-collision check ignores running work. | `pool.mjs:203`, `lib/parallel.mjs:13-30` |
| B7 | A failed dispatch leaves its worktree, so later dispatches of that task fail. | `index.mjs:140-149` |
| B8 | Starting two pools at once races: the pid file is checked, then written. | `pool.mjs:260-264` |
| — | Workers run `claude -p --dangerously-skip-permissions` with no guard, spend brake or runtime brake. TM-135 recorded workers dying on a 5-hour usage limit. | `lib/dispatch/tmux.mjs:32` |

**Live consequence now:** this store has `dispatch.enabled: true`. At the next session start the pool will run. Once
TM-164 finishes, it would dispatch TM-167 and TM-168 unattended, before any of the fixes below exist.

## Decisions (confirmed with Ryan)

1. **Readiness:** a shared check labels complete tasks `ready-for-agent` automatically. A human veto
   (`ready-for-human`, or any triage label a human set) is never overridden.
2. **Pool default:** on by default in every repo with a store, once Phase 1 lands. `dispatch.enabled: false` is the
   per-repo off switch.
3. **Worker permissions:** keep skip-permissions, and add a guard that blocks repo-destructive and external actions
   (the ADR-0001 classes).
4. **Finish line:** the worker pushes its `tm/<id>` branch and opens a PR. A human merges.

## Phases

### Phase 0 — board and immediate safety

- Set this store back to `tm config dispatch '{"enabled":false}'` until Phase 1 merges.
  - Do **not** run `tm config dispatch` with no value (B1).
- Create an epic ("Agent-first automation: computed readiness, always-on pool") and one `TM` task per work item below,
  each with `--ac`.
- Record the policy change with `tm adr new`. It reverses a choice that was never written down.

### Phase 1 — make the pool safe to leave running

Each fix starts with a regression test that fails before the fix.

- **B1/B2 (`bin/tm` config verb):**
  - `tm config <key>` with no value prints that key and writes nothing.
  - Dotted keys use the existing `getPath` and `setPath` from `lib/settings.mjs:318-333`; export them, don't copy.
  - Values are still JSON-parsed, so `tm config dispatch.enabled true` works.
- **B3:** `poolTick` skips tasks that fail `agentReadiness` (Phase 2), which includes `requireOnStart`, and records the
  reason in `skipped`. Bypassing `wipLimit` stays, as it is intentional (`CHANGELOG.md:273`).
- **B4:** count capacity from the board, not heartbeats. `busy` is the number of `in_progress` tasks with a `dispatched`
  record, counted after collect. Per-backend caps read `task.dispatched.backend`, which is set at `index.mjs:165`.
  `agents.mjs` is unchanged.
- **B5:** `stop()` sets a `stopping` flag, and the loop checks it after each tick as well as during the sleep.
- **B6:** add the `touches` of `in_progress` tasks to the occupied set before binning the queue.
- **B7:** `fail()` calls the existing `unprovision(task, { force: true, p })` from `lib/worktree.mjs:351` when the
  failed dispatch created the worktree.
- **B8:** write `pool.pid` with the exclusive `wx` flag; on `EEXIST`, re-check `livePool` and replace only a stale record.
- **Brakes (`pool.mjs`):**
  - After `dispatch.maxFailures` consecutive failed dispatches or collects (default 3), or one failure whose text matches
    a usage or quota limit, the pool pauses:
    - it records `pausedReason` in `pool.pid`;
    - it logs a `pool_paused` event, which ntfy already picks up from `events.jsonl`.
    - `tm pool resume` clears the pause.
  - `dispatch.maxRuntimeMinutes` (default 120): collect logs `worker_overrun` and leaves parking to a human.
- **Worker guard:**
  - Both spawn paths set `TM_DISPATCH_WORKER=1` in the worker env: `lib/dispatch/tmux.mjs:60` and topology `envFor`
    at `topology.mjs:149`.
  - A new `pre-bash` case in `bin/tm-hook` refuses, with exit 2, these commands in a worker session:
    - `git push --force` or `-f`, or `+refspec`
    - `git push` to any branch other than the task's `tm/<id>` branch
    - branch or tag deletion
    - `reset --hard` and `filter-branch`
    - `gh pr merge`
    - `gh release`
    - deploy commands, secret changes, and outbound messages
  - Plain `git push` of the task's own branch and `gh pr create` stay allowed (the Phase 5 finish line).
  - Delivery:
    - Add a `Bash` matcher to `hooks/hooks.json`.
    - Give `hooks/tm-hook.sh` a shell fast path, `[ "$EVENT" = pre-bash ] && [ -z "$TM_DISPATCH_WORKER" ] && exit 0`, so
      ordinary sessions don't start Node on every Bash call.
    - Also inject the hook with `--settings` in the worker command, so the guard holds even when the worker session
      hasn't loaded the plugin (for example, an untrusted worktree).

### Phase 2 — computed readiness and automatic triage labels

- **One check:** `agentReadiness(task, cfg) → { ready, missing[] }` in `lib/completeness.mjs`, next to
  `missingFields`. That module has no imports, so `store.mjs` can use it without a cycle. `issue.mjs` imports
  `store.mjs`, never the reverse (`store.mjs:1238-1241`), so the check cannot live in `issue.mjs`.
  - Move the `TRIAGE_LABELS` and `DECISION_KIND` constants into `completeness.mjs`; `issue.mjs` re-exports them.
  - Ready means all of these:
    - `requireOnStart` fields present
    - an epic when `requireEpic` is set
    - none of `ready-for-human`, `needs-info`, `wontfix`, `human-gate` (set by goal import, `goal-import.mjs:141`)
    - none of `decision:interview`, `decision:prototype`, `decision:unblock`, `decision:map` (`decision:research` is
      allowed)
  - Status and dependencies are left out on purpose: the label means "specified", and the pool still checks "startable
    now".
  - Callers: `poolable()`, `tm why`, `tm pool status`, the dashboard, and the label sync below. There is no second
    implementation.
- **Label sync in the write funnel:** inside `store.mjs` `create` (855) and `update` (876), for tasks that are not
  resolved and when `dispatch.autoReady` is `"label"` (the default), compute the triage label and merge it into the same
  write. No second write means no recursion and no event storm. Change a label only when the value changes.
  - The rule:
    - ready gives `ready-for-agent`;
    - not ready gives `needs-triage` and `triageMissing: [...]`;
    - either way, stamp `triagedBy: auto`.
  - A human-set triage label (no `triagedBy: auto`) is never touched. `issue.mjs` `labels()` clears `triagedBy` whenever
    a person sets a triage label, so a veto is sticky.
  - Before wiring, run `graft callers update` and `graft callers create` across the plugin. Confirm that CLI, MCP and
    HTTP all reach this funnel. Paths that write `labels` directly (`goal-import.mjs:258`, `planner-ops.mjs:159`) still
    go through `create` or `update`; check that.
- **Policy switch:** `dispatch.autoReady: "label" | "off"`, added to the settings catalog in `lib/settings.mjs`.
- **Creation surfaces:**
  - `tm task new --human` sets `ready-for-human` at create.
  - `skills/tickets/SKILL.md` and `skills/groom/SKILL.md` describe the veto instead of manual labelling.
- **Backfill:** `tm triage [--all] [--dry-run]` runs the sync over open tasks. It is manual only.
  - The three open tasks today (TM-105, TM-171, TM-172) are unaffected until edited or backfilled.
  - Veto TM-105 (it needs TeamCity access) before any backfill.

### Phase 3 — an always-available pool

- `run --auto` **does not exit when disabled.** It idles, re-reads config every `pollSeconds`, and prints only state
  changes (enabled, disabled, paused, took over), so the monitor stream stays quiet. Enabling from the CLI or dashboard
  takes effect within one poll.
- **Standby:** another session's `--auto` waits while a live pool holds `pool.pid`, and takes over when that pid dies.
  The pool outlives the session that started it as long as any session is open.
- **Default on:** `enabled` defaults to `true` in the settings catalog (`lib/settings.mjs:196-201`). Also change the
  tick's check at `pool.mjs:152` and the `--auto` check at `:257` to one shared `poolEnabled(cfg)`, so the loop and the
  tick cannot disagree again.
- **Session start:** `tm-hook session-start` prints one line, for example
  `pool on: N ready, M running — tm config dispatch.enabled false to stop`.

### Phase 4 — visibility and control

- `tm why <id>` adds a readiness section showing the verdict and what is missing. `tm pool status` adds enabled, paused
  reason, queue head and skip reasons, taken from a dry-run tick.
- **Dashboard:**
  - `GET /api/pool` in `lib/dashboard-api.mjs`.
  - A pool card with state, workers and queue, and an enable toggle through the existing `POST /api/settings` (line 233).
    No start/stop endpoints are needed once Phase 3 lands.
  - Readiness reasons on task cards.
- **Events:** `task_auto_triaged`, `pool_paused` and `worker_overrun` go to `events.jsonl`, and so to ntfy.

### Phase 5 — PR as the finish line

- The handoff (`lib/render.mjs:358-364`) tells the worker, when done, to commit, `git push -u origin tm/<id>-<slug>`,
  `gh pr create` with the `TM-nnn` key in the title, then `tm evidence` and `tm done`.
- `collect` records the PR URL on the task, found with `gh pr list --head <branch> --json url`, and does not fail when
  `gh` is missing.
- The guard from Phase 1 already allows exactly these commands.

### Docs and release

- Update `README.md:186-191`, `AGENTS.md:47-50`, `docs/agent-first.md:167-173,282`, `docs/use-cases.md:551-571`,
  `skills/pool/SKILL.md` and `.claude/rules/project-management.md:74`.
- `tests/unit/agent-first-docs.test.mjs` checks the docs; update it with the prose.
- `task-management` has no ecosystem semver: add a `CHANGELOG.md` entry with the TM and EP keys, and no `version` field.

## Execution

Parallel workers, each in its own worktree on a `tm/<id>` branch. The lead reviews, merges and runs git. Shut workers
down after their work is merged.

| Worker | Scope (owned files) | Starts after |
|---|---|---|
| W1 | B3–B8 and brakes: `lib/dispatch/pool.mjs`, `lib/dispatch/index.mjs`, `tests/unit/pool.test.mjs` | Phase 0 |
| W2 | B1/B2: `bin/tm` config verb, `lib/settings.mjs` exports, config tests | Phase 0 |
| W3 | Phase 2: `lib/completeness.mjs`, `lib/issue.mjs`, `lib/store.mjs` funnel, `tm triage` / `--human` | Phase 0 |
| W4 | Worker guard: `bin/tm-hook`, `hooks/*`, spawn env in `tmux.mjs` / `topology.mjs` | Phase 0 |
| W5 | Phase 3 | W1 + W3 merged |
| W6 | Phase 4 dashboard + CLI surfaces | W5 merged |
| W7 | Phase 5 + docs | W4 + W5 merged |

W1 and W3 both touch `poolable()` in `pool.mjs`. W3 only exports `agentReadiness`, and W1 wires it in after W3 merges.

## Verification

- **Where to run:** in a clean worktree, not the main checkout, which holds other sessions' uncommitted files. Record the
  commit and the dirty state with every result.
- **Suites:** `node --test --test-concurrency=1 task-management/tests/unit/`, then each `task-management/tests/*.sh`.
  Check exit codes, not output tails.
- **Regression tests:** one per defect (B1–B8), brake, standby takeover and live enable. Each is shown failing on the
  pre-fix commit.
- **End to end in a scratch store** (`mktemp -d`, `git init`, `tm init`, fake backend via `TM_DISPATCH_REGISTRY`):
  1. A complete task is auto-labelled `ready-for-agent`. An incomplete one gets `needs-triage` with `triageMissing`. A
     human `ready-for-human` survives a later edit.
  2. `tm pool run --auto` starts while disabled. Flipping `dispatch.enabled` to `true` dispatches within one poll.
  3. The fake worker finishes, collect frees the slot, and `busy` never exceeds `poolWip` after the 30-minute TTL (test
     with a short `agentTtlMinutes`).
  4. Stop sent during a slow fake tick exits. Killing the owning pool lets the standby take over. Three failures pause the
     pool, and `resume` clears the pause.
- **Guard:** a worker-env session in the scratch repo is refused `git push --force` and `gh pr merge`, and allowed
  `git push` of its own branch and `gh pr create` against a local bare remote. Confirm the guard also holds when injected
  only through `--settings`.
- **tmux smoke test:** only with `TMUX=''`, a per-test `TMUX_TMPDIR`, and `-L <name>`
  (`.claude/rules/tmux-test-isolation.md`).
- **Dashboard:** check through agent-browser that the pool card, the enable toggle and the readiness reasons show and
  respond.
- **Plugin manifest:** `claude plugin validate ./task-management`, without `--strict`.
