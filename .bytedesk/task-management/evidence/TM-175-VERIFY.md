# TM-175 verification: the dispatch pool is safe to leave running

**Result:** all eight acceptance criteria are met, and so is the lead's follow-up on keeping claims.

- The worker's commits are `99763a6` (the fixes) and `efc0e42` (keep an earlier claim; lock the pause file), on branch `worktree-agent-af4f8edf77c041f95`, based on `cd1b1ac`.
- They were merged to `main` in the lead's checkout.

## What was measured

- **Where:** the worker's worktree, with a clean tree (`git status --short` printed nothing at either commit).
- **Who:** the lead re-ran every command below, independently of the worker's report.

| Commit | Command | Exit | Result |
|---|---|---|---|
| `99763a6` | `node --test --test-concurrency=1 task-management/tests/unit/*.test.mjs` | 0 | 1392 / 1392 pass |
| `99763a6` | `bash task-management/tests/test-pool.sh` | 0 | 26 passed, 0 failed |
| `efc0e42` | `node --test --test-concurrency=1 task-management/tests/unit/*.test.mjs` | 0 | 1393 / 1393 pass |
| `efc0e42` | `bash task-management/tests/test-pool.sh` | 0 | 26 passed, 0 failed |

- **Baseline:** on clean `cd1b1ac` the worker's run gave 1374/1374 unit tests and 19/19 `test-pool.sh`, so there are no pre-existing failures.

## Red before green (worker's run)

- **New tests against unmodified code:** 16 of the 18 new tests in `pool-safety.test.mjs` failed, each at its own assertion. Two examples: capacity was 2 instead of 0, and there were 6 dispatches instead of 3. The other two are guards on existing behaviour.
- **`test-pool.sh`:** 7 new failures.
- **One fix reverted at a time:** 14 reverts, each run in a scratch copy, and each turned its own test red. The reverted fixes were B4, B5, B6, B7, B8 without `wx`, `maxFailures`, the quota check, the dropped summary, "a close never resets", "any old close resets", "the pause is not reloaded", the gitignore entry, "overrun never noted" and "overrun logged every tick".
- **Follow-up test:** a claim held by the session before the dispatch survives a failed spawn. It failed on `99763a6` (`undefined !== 's1'`) and passes on `efc0e42`.

## Acceptance criteria

1. **Capacity (B4):** capacity is counted from `in_progress` tasks that have a `dispatched` record, after collect runs. Backend caps are charged by `task.dispatched.backend`. With an expired agent heartbeat, `poolWip` still holds.
2. **Stop (B5):** SIGTERM during a slow tick ends the loop after that tick and removes `pool.pid`.
3. **Collisions (B6):** the `touches` of `in_progress` tasks count as occupied, and the skip reason names the running task.
4. **Leftover worktree (B7):** a dispatch that fails after provisioning removes its worktree, and a later dispatch of that task succeeds. After `efc0e42`, a claim that existed before the dispatch is kept.
5. **Startup race (B8):** `pool.pid` is taken with `wx` under the store lock, and two concurrent `runPool` calls on one store give exactly one pool. This is proven inside one process; there is no separate-processes test.
6. **Brake:**
   - The pool pauses after `dispatch.maxFailures` consecutive failures (default 3), or after one quota-shaped failure.
   - The pause is stored in `pool.state.json` (gitignored), survives a restart, logs `pool_paused`, and is cleared by `tm pool resume`.
   - Only a dispatched task that closes after the last failure resets the count. This follows the lead's choice ("reset on done", not "reset on dispatch").
   - Every read-modify-write of the file runs under `withLock`.
7. **Overrun:** collect logs `worker_overrun` once for each dispatch still running after `dispatch.maxRuntimeMinutes` (default 120). It does not park the task.
8. **Regression tests:** each fix has one, shown red first, and both suites exit 0.

## Known limits (accepted)

- **Refusals count as failures:** every `dispatch()` refusal adds to the failure count, including a rare claim-race refusal. A collect error with `ok: false` does not.
- **Manual-backend tasks:** these count as busy until they close.
- **Pause file ignore rule:** the ignore rule for `pool.state.json` reaches an existing store's `.gitignore` only through `tm doctor --fix` or `tm init`.
- **Readiness gate (B3):** routing pool dispatch through the readiness check is not in this task. It belongs to TM-178.
