# TM-111 criterion 2: explicit bootstrap fixture and mutation proof

The authenticated sandbox unit test now creates a private temporary host home
containing `.codex/auth.json` with an explicitly synthetic marker. The comment
explains why the file must exist: the real planner only emits the auth mount when
it can stage that bootstrap input. Removing it would stop exercising the security
assertion. `t.mock.method(os, "homedir", ...)` scopes the fixture to this test and
restores it automatically; it does not change process.env.HOME or production code.
The test verifies the broker-staged bytes equal the marker and still asserts the
original host auth path never appears in the mount argv.

The original mount-order assertion is preserved verbatim. A separate empty-home
case verifies that protected home ancestors still exist and no auth destination
is invented, whether read-only or writable. This separates missing input from
missing protection rather than conflating them in one compound error.

## Proof that losing protection still fails

`mutation-check.mjs` copies current source and the repaired test into a fresh
temporary directory, supplies an empty outer HOME, and runs the exact named case.
It never mutates the worktree source or bundle. Each mutation must exit 1 **with
the original security assertion**, not a syntax, import or setup failure.

| Temporary mutation | Exit | Observed failure |
|---|---:|---|
| Remove provider-home root bind | 1 | Original mount-order assertion |
| Remove Codex-home bind | 1 | Original mount-order assertion |
| Remove all protected ancestor binds | 1 | Original mount-order assertion |
| Remove exact auth mount | 1 | Original mount-order assertion |
| Make auth mount writable | 1 | Original mount-order assertion |
| Reverse ancestor mount order | 1 | Original mount-order assertion |
| Mount auth before protected ancestors | 1 | Original mount-order assertion |

The unmutated copy passes before these seven red runs. Restoring the exact
original source bytes makes the same test pass afterward. `mutations/results.json`
records every exit code and source SHA-256; individual logs are retained beside
it. The worktree production planner hash remains
`8f3e8ca725d159182b4fa0990e1a2fd4e372379d2ee3f331c6c0a766bb06b0d2`.

Reproduce with an installed resolved Node 22 executable:
`node agent-orchestration/docs/evidence/TM-111/mutation-check.mjs` from the repository
root. Children use `process.execPath`, explicit safe PATH and temporary HOME, so
this does not repeat the historical HOME-dependent Node shim setup incident.

## Verification

| Local check | Result |
|---|---|
| Repaired sandbox test file | 9 passed, zero failures/skips |
| Full unit suite, native Node 22.22.3, empty HOME | 246 passed, zero failures, 4 Windows-only skips |
| Full contract suite with synthetic providers | 3 passed, zero failures/skips |
| Seven mutation rejections plus before/restore controls | 7 expected failures at exact assertion; 2 passes |
| Offline design check | 31 locked files pass |
| build:all and build:check | pass; tracked dist has zero diff |
| Plain Claude plugin manifest validation | pass with expected versionless-plugin advisory |
| Roadmap check | pass |

Unit and contract files ran through the same Node test runner/globs as package
scripts, using a fresh outer HOME and the resolved executable. No real credential
or model API was used by the final runs. Contract tests execute fake providers,
loopback infrastructure and an isolated tmux fixture. The clean-install test left
a detached session host after deleting its fixture directory; its process start
was within this run's exact eight-second window. That task-owned process was
identified and stopped separately (ac2/cleanup.json); older peer session hosts
were preserved. No session-supervisor implementation change is included. The existing GitHub workflow already runs this unit glob;
no workflow or runtime change is needed. `ac2/` contains logs and provenance.

This is green local branch evidence. Main cannot include the fix until the lead
merges the PR; neither main-green status nor a hosted workflow result is claimed.
The four skips are the existing native Windows/AppContainer cases on Linux, not
quarantine of the failing test. No test was weakened or quarantined. No task tick,
closure, merge, provisioning or spending occurred. Criteria 1/3 historical evidence
remains in README.md at its recorded revision.
