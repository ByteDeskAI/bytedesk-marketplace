# TM-427 checks at fccb17b1b24b7abd592a75a500c37f638901a447

All runs used `env -i PATH HOME USER LANG` so this session's identity variables
(`TM_DISPATCH_WORKER`, `AO_SESSION_AGENT_ID`, `AO_AGENT_ID`) could not leak into the tests.
The working tree was clean apart from unrelated graft/editor config (`.claude/`, `.grok/`,
`opencode.json`), which no test reads.

| Check | Command | Exit | Result |
|---|---|---|---|
| agent-orchestration unit (CI's command) | `npm --prefix agent-orchestration test` | 0 | 1330 tests: 1326 pass, 4 skipped, 0 fail |
| agent-orchestration build:check | `npm --prefix agent-orchestration run -s build:check` | 0 | |
| task-management unit | `cd task-management && node --test tests/unit/*.test.mjs` | 0 | 1701/1701 |
| agent-orchestration validate | `claude plugin validate ./agent-orchestration` | 0 | |
| task-management validate | `claude plugin validate ./task-management` | 0 | |
| agent-orchestration contracts | `node --test --test-concurrency=1 tests/contract/*` (excluding clean-install), `TMUX=''`, private `TMUX_TMPDIR` | 0 | 18/18 |
| GitHub CI run 37904262023 | unit-build-contracts, TM-111 strict cache, test-build-install | success | headSha fccb17b1 |

## Configured required checks, exact argv (after the main merge)

| Check | Exit | Result | File |
|---|---|---|---|
| `agent-orchestration: unit` (`env -i … npm run -s test:unit`), run 1 | 1 | 1325 pass, 1 fail: topology-launch "a pane's liveness and exit status come from one answer" | `ao-unit-exact-run1.txt` |
| `agent-orchestration: unit`, run 2 | 0 | 1330 tests: 1326 pass, 4 skipped, 0 fail | `ao-unit-exact.txt` |
| `plugin-rsync: tests` | 0 | | `plugin-rsync.txt` |

Run 1's failure is a pre-existing tmux race, filed as TM-527. A probe sampling `paneState`
every 100 ms for 3 s, run 12 times in parallel, showed dead/42 in 11 runs and dead/null for
the full 3 s in 1. The status never arrives, so this is not a slow read. The test,
`topology/lib/tmux.mjs` and the tmux test helpers are identical to main.

## Changes in this pass

- `tests/contract/topology-lead-recovery-tmux.test.mjs`: CI failed 3/9 after TM-462B, because
  the fixture claimed the source lead by env and read the destination lead's inbox through the
  identity-checked CLI. The fixture now sends as a source worker and reads the inbox through
  the host-local `readStandingInbox`.
- `tests/unit/mcp-contract.test.mjs`: the TM-352 test pins `AO_TRANSPORT=file` for its whole run.
- Merged `origin/main` (117 commits). CHANGELOG conflict: both entries kept. `dist/` rebuilt.
- Merge fix: `delegation.mjs` re-imports `callerRunsInPane`, which main's TM-473
  `callerUnderBoundPane` still calls. Without it the operator-only console check failed
  closed with a ReferenceError (2 unit failures).

## Required-check definition gap (not fixed here)

The `agent-orchestration: unit` entry in `.bytedesk/agent-orchestration/config.json` runs
`node --test tests/unit/*.test.mjs` without the suite's preloads (`tmux-preflight.mjs`,
`register-file-transport.mjs`). On a host running a live NATS broker, that command reaches
the broker: `topology-collaboration` and `mcp-contract` hang, and `runtime-diagnostics`
3–4, `tmux-isolation`, `topology-activation` and `topology-collaboration` fail. The same
failures occur at the merge base 0110e0b7, so this branch did not cause them.
`ao-unit-bare-d0de2e7f.txt` is that partial run; it was stopped after hanging. The
CI-equivalent `npm test` is the run reported above. The fix is to make that required check
run `npm --prefix agent-orchestration test`. This branch leaves the config alone, because a
worker editing its own required checks is the TM-505 risk.

Flake noted: `topology-launch` "a pane's liveness and exit status come from one answer" failed
once inside a two-file run, then passed 4 times out of 4 when run alone. This branch does not
change that test or the code it exercises.
