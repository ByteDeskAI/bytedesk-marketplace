# TM-179 verification: pool state and readiness, visible

**Result:** the CLI and HTTP halves are done and merged. The dashboard's React surface was split
out as **TM-188**, because it cannot be built or verified in this checkout.

- **Commit:** `40ca731` on branch `tm/TM-179-visibility`, based on `59e72e4`.
- **Work done by the lead session**, not a worker: the account's session limit had stopped the
  subagents.

## What was measured

| Tree | Command | Exit | Result |
|---|---|---|---|
| `40ca731`, clean worktree | `node --test --test-concurrency=1 task-management/tests/unit/*.test.mjs` | 0 | 1487 / 1487 |
| same | `bash task-management/run-tests.sh contract` | 0 | all green |

## Red before green

The new `tests/unit/pool-visibility.test.mjs` was run against the pre-change code (`59e72e4`) in the
main checkout, twice, because the first red was too weak to count:

1. **Whole file:** failed at import — `does not provide an export named 'poolStatus'`. That is a
   module error, and it proves nothing about the assertions.
2. **Behavioural half, with the import stripped:** 3 of 4 failed on the old code, the first at
   `why() carries a readiness verdict`. The fourth ("says nothing about readiness once resolved")
   passes on old code by construction and is a guard, not evidence.

After the change: 6 of 6 pass.

## A contract the suites caught me breaking

The first implementation pushed readiness into `why().reasons`. Two existing checks went red:
`graph.test.mjs` ("reports a startable task as startable, with no reasons") and `test-read.sh`
(`.startable == true and (.reasons | length) == 0`).

They were right and the change was wrong: `reasons` means *what is holding this up*, and a pool
skipping a task holds nothing up for a person. Readiness became its own `readiness` field instead.
The assertions were not touched.

## Acceptance criteria

1. **`tm why <id>` prints the verdict and the missing items.** Every unresolved task gets a `→`
   line: `ready for an agent`, `not ready for an agent: <missing>`, or `triaged by a person` with
   what an agent would still need. In `--json` it is `readiness` — `{ ready, missing, human, text }`.
   It never changes `startable`.
2. **`tm pool status` (and `--json`)** reports enabled, running, pid, paused reason and failure
   count, workers against `poolWip`, the ready count, `pollSeconds`, `idleExitMinutes` and the log
   path. Per-task skip reasons deliberately stay in `tm why` and the pool log: a read-only status
   must not run a tick, and a tick collects.
3. **`GET /api/pool`** returns exactly what the CLI prints. Both call one `poolStatus()` in
   `lib/dispatch/pool.mjs`. The test asserts **deep equality** against `poolStatus(p)`, so a route
   that grew its own copy of the shape would pass a field-by-field check and fail this one. The
   route starts no pool; a second test checks it while the pool is off.
4. **Events:** `pool_paused` and `worker_overrun` are in the ntfy catalog and reach `events.jsonl`.
   There is no `task_auto_triaged` event, and there should not be: TM-176's criterion is that the
   label rides in the same write, so an automatic change is visible in that task's `update` event
   and its patched-field list.

## Split out (TM-188)

The dashboard pool card and readiness on task cards. `task-management/dashboard` depends on
`@bytedesk/design-tokens` and `@bytedesk/design-ui` from the private registry and has no
`node_modules` in this checkout, so neither `npm run build` nor an agent-browser check could run.
Writing the React surface without being able to build it would have been prose, not a feature.
