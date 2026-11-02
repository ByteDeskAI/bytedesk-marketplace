# TM-292 evidence — revision 534c231a4d9362deeda0ec035e2acba697efff92

## AC1 — the brief tells a print-mode worker to stay in the foreground
`sessionRules()` (rendered by both `handoff()` and `workerBrief()`) now says the worker runs as
`claude -p`, exits when its turn ends, must run every command in the foreground, and may end its
turn only once it has committed and reported, or blocked.
Asserted in `tests/unit/result.test.mjs` (handoff) and `tests/unit/subagent-brief.test.mjs` (worker brief):
both pass.

## AC2 — a dirty exit with no finish and no block is "exited mid-task"
`collectSession()` (tmux backend): task still in_progress + dirty worktree →
`worker exited mid-task: no finish report, no block, uncommitted work` + `last assistant message: "<text>"`
read from the newest transcript in `~/.claude/projects/<sanitized worktree>/`, failure scope `task`.
Unit test: `ok 5 - session gone + dirty worktree = 'exited mid-task' naming the last assistant message (TM-292)`
(fixture uses the TM-276 message verbatim, a thinking block, a later tool_result and a partial line).

## Test runs
task-management full unit suite (`node --test --test-concurrency=1 tests/unit/*.test.mjs`):
- this change: 1727 tests, 1677 pass, 50 fail
- base 8189a6bd, clean detached worktree: 1726 tests, 1676 pass, 50 fail
- the failing-test name sets are IDENTICAL (diff empty). +1 test is the new TM-292 case.
- cause of the 50: the suite runs inside this dispatched worker's process tree, so
  `isWorkerCaller()` detects the worker by ancestry and refuses (`a dispatched worker cannot grant
  or change governed task ownership` ×28, `cannot rebind its own dispatch` ×2, their parent suites).
  Stripping TM_* env does not help; detection is by process ancestry.

## Required checks at 534c231a
| check | exit |
|---|---|
| agent-orchestration: npm ci | 0 |
| agent-orchestration: build:check | 0 |
| agent-orchestration: plugin validate | 0 |
| task-management: plugin validate | 0 |
| plugin-rsync: tests | 0 |
| task-management: unit | 1 (41 fail, all worker-ancestry refusals as above) |
| agent-orchestration: unit | 1 (11 fail; `tm govern: a dispatched worker cannot…` and dependent asserts; AO not touched) |

Both unit checks need re-running outside a dispatched worker (by the reviewer/lead).
