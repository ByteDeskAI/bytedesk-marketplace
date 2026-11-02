# TM-417 verification at fba56ed869c30a244d649c6c025f92a3f8434a0e (PR #237)

Tree: only TM-417 files committed; the uncommitted graft wiring (.claude, .grok, .mcp.json) is another session's and was not part of any check.

| check | command | exit |
|---|---|---|
| agent-orchestration: npm ci | npm --prefix agent-orchestration ci --no-audit --no-fund | 0 |
| agent-orchestration: build:check | npm --prefix agent-orchestration run -s build:check | 0 |
| agent-orchestration: plugin validate | claude plugin validate ./agent-orchestration | 0 (expected versionless warning) |
| task-management: plugin validate | claude plugin validate ./task-management | 0 (expected warnings) |
| agent-orchestration: unit (configured argv, no preloads) | cd agent-orchestration && env -u TMUX node --test --test-concurrency=1 tests/unit/*.test.mjs | 124: hung after test 109 and hit the 900s timeout. Without the suite's preload imports a file never exits; the existing TM-240 test hangs the same way on its own |
| agent-orchestration: unit (canonical) | npm run -s test:unit (with tmux-preflight and file-transport preloads) | 0: 1245 tests, 1241 pass, 0 fail |
| task-management: unit (worker env) | cd task-management && node --test tests/unit/*.test.mjs | 1: 11 fail. The inherited TM_SESSION_ID, TM_ACTOR and TM_DISPATCH_* broke claim, actor and session tests |
| task-management: unit (worker env stripped) | same, with TM_*/AO_SESSION_* unset | 1: 1663 tests, 1661 pass, 2 fail (lock.test.mjs 6 and 9) |
| control: base ab2006bc, same stripped env | same | 1: 1659 tests, 1657 pass, the same 2 lock.test.mjs failures, so they predate this change |

New tests (each mutation-checked; they fail when the fix is reverted):
- topology-management: TM-016 repro then rebind, with refusals; admission keeps tm-<task>; AC4 end to end (real tm CLI, admit, tm dispatch on tm's real topology backend with ao-topology stubbed, finish, reviewer request queued, governance ready-for-review).
- topology-prompt-lifecycle: AC3 bindStagedPrompt, then ack succeeds; supervision keeps the prompt awaiting-ack.
- task-management result.test: tm rebind and collect repair, with refusals. dispatch-backends: canonical workflow id.

Not verified: AC3 on a live pool-launched pane.
