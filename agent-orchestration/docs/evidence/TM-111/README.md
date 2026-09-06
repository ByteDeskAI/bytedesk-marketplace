# TM-111: diagnose before repair

This is the accepted historical criteria 1/3 checkpoint at `975b8de`, against
`834f4ce`. Reproduce `diagnose.mjs` from that checkpoint: the original test has
since been repaired. Current criterion 2 work and mutation evidence are in
[AC2.md](AC2.md); the historical logs below remain unchanged.

## Criterion 1: a missing fixture precondition, not absent mount ordering

At main `834f4ce`, the unchanged test fails with an empty HOME and passes when a
fresh HOME contains only a synthetic `.codex/auth.json`. The security invariant
it asserts is valid. The test fails to arrange the authentication input needed
for its unconditional auth-mount expectation. This is an environment-dependent
test defect present from introduction, rather than a later implementation drift.

The compound assertion does not reveal which term failed. Breaking down the
actual argv exposes that the ancestor mounts **are present in both cases**:

| Mount | Empty HOME index | Synthetic auth HOME index |
|---|---:|---:|
| Writable worktree | 84 | 84 |
| Writable scratch | 89 | 89 |
| Protected provider-home root | 92 | 92 |
| Protected Codex home | 95 | 95 |
| Exact read-only auth.json | -1 (absent) | 98 |
| Read-only .git marker | 100 | 103 |
| Read-only shared Git directory | 103 | 106 |

`prepareProviderHome` (`src/provider-sandbox.mjs:93`) always constructs the
protected provider-home ancestors, but line 115 skips a bootstrap file when it
cannot access the source under `os.homedir()`. The final `--ro-bind` exists only
for a staged auth file. `sandboxPlan` lines 298-304 emits writable workspace,
scratch, protected ancestors, exact auth and Git mounts in that order. The test
at `tests/unit/provider-sandbox.test.mjs:73` creates workspace/Git/scratch/control
directories, but no fixture HOME or auth file. Line 108 therefore fails on a
credential-free CI runner because `providerAuthReadOnly` is -1. It can pass on a
logged-in workstation by using ambient credentials, which is itself unacceptable
for a deterministic security test.

This diagnosis does **not** weaken or remove the invariant, make auth writable,
or infer that a green developer-machine run establishes the boundary. Neither
source nor test was modified. `provenance.json` records their exact SHA-256s.

## Kernel evidence with fixtures only

The diagnostic invokes the unchanged source planner and an exact temporary copy
of the committed `dist/provider-sandbox.cjs`, with no node_modules or source link
needed by that bundle. Both emit identical mount indices above. A local Bubblewrap
process executes only a Node filesystem probe in place of the provider command:

| Probe | Source plan | Committed bundle plan |
|---|---|---|
| Rename provider-home root | EBUSY | EBUSY |
| Rename Codex home | EBUSY | EBUSY |
| Rename auth mount | EBUSY | EBUSY |
| Write auth copy | EROFS | EROFS |
| Write .git marker | EROFS | EROFS |
| Write shared Git directory | EROFS | EROFS |
| Write worktree fixture | allowed | allowed |
| Write scratch fixture | allowed | allowed |

All **16 runtime observations** meet those exact expectations. No real provider,
host credentials, network helper, external service or provisioning was invoked.
The process uses the planner's isolated network namespace with no egress helper.
This establishes the named Linux/Codex mount behavior with synthetic auth. It is
not a complete sandbox audit, proof of Windows behavior, all providers, or actual
client installation/cutover. No sandbox escape was reproduced by this case.

Reproduce from this directory with an already installed, resolved Node executable
(version 22.22.3 here): `node diagnose.mjs`. The diagnostic uses `process.execPath`
for isolated-HOME children and an explicit PATH, never a HOME-dependent launcher
shim. It reruns the original failing test unchanged twice, constructs four plans,
and runs the two eight-observation kernel probes. `empty-home.txt`,
`fixture-auth-home.txt`, and `diagnosis.json` preserve outputs. The deliberate
empty-HOME test failure remains red; a zero diagnostic-launcher exit is not a
claim that the repository suite passed. `initial-reproduction.json` records the
independent two-case reproduction before the diagnostic script was added.

A first local attempt used the machine's `node` shim after stripping its normal
HOME/toolchain environment. That launcher recursed before producing test output;
39,174 task-owned processes were stopped. The setup attempt is excluded from test
evidence. The successful runs use the resolved executable and a bounded timeout;
no peer session was interrupted. Fixture directories and processes are removed.

## Criterion 3: origin and release/distribution history

The assertion was already failing in the first committed plugin revision. Its
predecessor `257e43f` predates Agent Orchestration; there is no known-good committed
predecessor of this test. Exact GitHub logs:

| Revision / meaning | First relevant log observed (UTC) | Failure evidence |
|---|---|---|
| `64e099a` initial plugin | 2026-08-21 13:55:02 | [job 96792989707](https://github.com/ByteDeskAI/bytedesk-marketplace/actions/runs/32489317361/job/96792989707) |
| `ea85b8d` package 0.2.0 | 2026-08-22 02:29:57 | [job 96965497020](https://github.com/ByteDeskAI/bytedesk-marketplace/actions/runs/32546392041/job/96965497020) |
| `272a01f` package/server 0.3.0 | 2026-09-04 03:28:00 | [job 100900328303](https://github.com/ByteDeskAI/bytedesk-marketplace/actions/runs/33833200839/job/100900328303) |
| `811e090` 0.4.0 changelog cut | 2026-09-06 02:53:42 | [job 101417606940](https://github.com/ByteDeskAI/bytedesk-marketplace/actions/runs/34007615527/job/101417606940) |
| `50b3e87` 0.2.0/0.3.0 changelog backfill | 2026-09-06 02:58:43 | [job 101418115330](https://github.com/ByteDeskAI/bytedesk-marketplace/actions/runs/34007804047/job/101418115330) |

Every linked job contains the exact unrenameable-auth-ancestor assertion. Other
sampled revisions (`27eb1c3`, `3dd63ed`, `2bf0b3d`) show it too. This establishes
recurrence since introduction, not observation of every run in between. At
`50b3e87`, Unit tests failed and rebuild, bundle drift, installed-cache contract
and manifest steps were **skipped**, not green.

Versioned source was available on main while this assertion was red. Package
0.4.0 actually first appears at `9a5a1a9`; `811e090` records the changelog, not the
first package-version change. No workflow run was returned for `9a5a1a9` itself.

GitHub's release/tag inventory has six Fleet releases from May 10 and no observed
Agent Orchestration release/tag. That does **not** mean no plugin version shipped:
the Claude manifest and marketplace entry were versionless from the initial
commit, and this repository distributes committed plugin payloads through main.
The 0.2.0, 0.3.0 and 0.4.0 source/bundle revisions were consequently available for
installation while the case remained red. History establishes availability, not
which clients installed them. No npm publication or installed-client audit is
claimed. [Release inventory](https://github.com/ByteDeskAI/bytedesk-marketplace/releases).

## Criterion 2: deliberately untouched pending diagnosis review

No source, original test, bundle or workflow repair/quarantine is included. The
workflow is not made green by this evidence-only PR and no owner/date quarantine
has been invented. A subsequent repair should make the auth fixture explicit and
separately cover absent auth while preserving the ordering and kernel refusal
assertions. That is a proposed direction, not implementation or acceptance.

Only this evidence directory is changed. The narrow unchanged test was run in two
controlled environments; no full suite, package rebuild, live-provider test or
hosted workflow was requested. Roadmap validation passes (55 tasks, 96 unlocks,
6 goals, 7 trajectories, 7 gaps). No merge, task tick, task closure or spending.
