# TM-178 verification: pool on by default, one detached pool per repository

**Result:** every acceptance criterion is met. This supersedes the earlier record of `2e198f3`,
which was the pre-redesign commit using a standby model that Ryan rejected.

## History of the task

1. `2e198f3` — pool on by default, live config, readiness gate, **standby** (every session ran a
   waiting loop). Verified green, then rejected on cost: about 60 MB per extra session per repo.
2. Redesign to one **detached** pool per repository. The worker was stopped twice by events outside
   the work (an accidental stop, then the account session limit). Its uncommitted work was preserved
   by the lead as `225711a`, and finished from there.
3. `f240f1f` — the lead wrote the documentation sections against the merged code.

Merged to `main` as `59e72e4`. The merged tree is identical to the tested tree for
`task-management/` and `.claude/rules/`.

## What was measured

| Tree | Command | Exit | Result |
|---|---|---|---|
| `225711a`, worker worktree, clean | `node --test --test-concurrency=1 task-management/tests/unit/*.test.mjs` | 0 | 1469 / 1469 |
| same | `bash task-management/run-tests.sh contract` | 0 | all green |
| `45d55af` (pool + docs combined), clean | unit glob | 0 | 1481 / 1481 |
| same | contract | 0 | all green |
| `f240f1f` (final), clean | unit glob | 0 | 1481 / 1481 |
| same | contract | 0 | all green |

## Live check of the process model (lead, temp store)

Run against a throwaway store (`mktemp -d`, `TM_ROOT` set, `TMUX` blank, `pollSeconds: 1`,
`idleExitMinutes: 0.02`), never against a real board:

| Step | Observed |
|---|---|
| `tm pool ensure` with none live | `pool: running (pid 2790910)`, exit 0 |
| `tm pool ensure` again | same pid reported, no second process, exit 0 |
| `tm pool status` | `pool running (pid 2790910, …) — 0/3 workers, 0 ready` |
| the store after one second | `pool.log` and `pool.pid` present; the log holds the state line |
| after the idle window | `(no pool running)`, and zero `tm pool run` processes for that store |
| `tm config dispatch.enabled false` then `ensure` | `pool: off (dispatch.enabled false)`, exit 0 |

That last line also re-confirms TM-174: a dotted key write reaches `config.dispatch.enabled`.

## Acceptance criteria

1. **One on/off test.** `poolEnabled(cfg)` — on unless `dispatch.enabled === false` — is used by the
   loop, the tick and `tm pool status`. The settings catalog default is `true`.
2. **One detached pool per repository.** `tm pool ensure` starts one when none is live and exits; it
   is a no-op when one is live or the pool is off. The pool outlives the session that asked, so extra
   sessions cost nothing. Callers: the `tm-pool` monitor, the user-prompt hook, a `tm config
   dispatch.*` write, and the dashboard settings save. `tm pool run --auto` is an alias of `ensure`,
   so a cached `monitors.json` still asks rather than becomes the pool.
3. **Idle exit.** With no dispatched worker and nothing to pick up for `dispatch.idleExitMinutes`
   (default 60; `0` never), the pool exits and releases `pool.pid`. The next `ensure` starts a fresh
   one. Proven live above, and in unit tests with a tiny window.
4. **Kill switch.** An explicit `dispatch.enabled: false` makes `ensure` start nothing, and stops a
   running pool within one poll. Setting it back to true starts one at once through the config or
   dashboard trigger.
5. **Readiness gate (B3).** `poolTick` skips a labelled task that fails `agentReadiness`, with the
   missing fields as the reason, and the skip does not count against the brake.
6. **Quiet stream.** Only state changes are printed, to `pool.log` when `ensure` started the pool.
7. **Session-start line.** One line reports pool state, the ready count and the working count.

## Existing tests changed

- `pool.test.mjs`, "--auto is opt-in": now sets `enabled: false` explicitly and expects the new
  reason; the "no loop, no pid file" assertions are kept.
- `test-pool.sh`: the `--auto` section now sets the flag false, and three checks were added — status
  reads enabled by default, `pool start` refuses while off, and the refusal names the switch.
- The `ready()` helpers in `pool.test.mjs`, `pool-safety.test.mjs` and `policy.test.mjs` now create
  complete tasks, because the readiness gate would otherwise skip them. No assertions were loosened.

## Notes

- **Leaked test pools.** Three detached pools from earlier test runs survived against deleted temp
  stores and were killed by hand. Tests should stop their children; worth a follow-up.
- **TM-179** (dashboard pool card, readiness in `tm why`) is not in this work and stays open.
