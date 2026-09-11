# TM-167 / TM-168 / TM-185: integration verification before landing

**Result:** all four workers' branches are merged. On a clean tree with tmux isolated, every check
below passes. The branch is `tm/EP-019-leads-icons`, and the release commit on top of it is `6189201`.

## What was merged, in order

1. **Seam commits.**
   - `4d76a60`: the enrollment contract.
   - `6bf4faa`: the role-visual registry, checked character for character against the TM-168 ticket.
2. **W6:** presence and census `roleIcon`/`roleLabel`, the addendum and fixtures (`cf22cc7`).
3. **W3:** the enrollment resolver, enrollment-gated activation and scoped tmux listing (`ccd3ed1`).
4. **W4:** receiver-owned lead recovery, held-mail backoff and enrollment hold reasons (`497bbe8`).
5. **W5:** terminal titles, `run.json` and CLI rows (`48d92d0`), then scoped listings (`02b8380`)
   and the TM-185 lead run-pane icon (`78cae6c`).
6. **Integration fixes by the lead:**
   - `9ec014f`: the linked-worktree convergence contract test, and the enrollment docs.
   - `6dbb5a8`: the convergence test counts only registration files.
   - `7f329a9` and `d34fe04`: census recomputes icons from each row's roles; the addendum and its
     recorded hash are updated.
7. **Merge conflicts.** The only one was `cli.mjs` `session open`, resolved by keeping both W5's
   `roleVisual` and W3's `activate(ctx, 'session-open')`.

## Problems found only on the merged tree, and fixed

- **W5's authority scan against W6's census.** W5's scan ("no topology code reads a role icon back
  to decide anything") failed on W6's census `visualOf`, which compared stored icons.
  - Fix: census now recomputes each icon from `repoRole`, `runRole` and `roleName`.
  - Proof it can fail: if census trusts stored icons again, 2 tests fail.
- **The convergence test miscounted registrations.** It counted `<key>.recovery.json` as a
  registration.

## Final checks on the merged tree `665ace6`

Every run used `TMUX=''` and a private `TMUX_TMPDIR`. The tree was clean before and after.

| Check | Result |
|---|---|
| `node --test --test-concurrency=1 tests/unit/topology-*.test.mjs` | 446 tests, 446 pass, exit 0 |
| `tests/contract/topology-tmux.test.mjs` | 5/5 |
| `tests/contract/topology-activation-tmux.test.mjs` | 3/3 |
| `tests/contract/topology-lead-recovery-tmux.test.mjs` | 3/3 (W4's test, on the merged code) |
| `tests/contract/topology-role-icon-tmux.test.mjs` | 1/1 |
| `tests/contract/topology-lead-convergence-tmux.test.mjs` | 1/1 |
| `node scripts/roadmap.mjs --check ROADMAP.md` | ROADMAP OK, exit 0 |
| `python3 topology/fixtures/presence-role-icon/check.py` | conforms |
| `claude plugin validate ./agent-orchestration` | passes, with only the expected version warning |
| Test supervisors still running afterwards | 0 |

**The convergence test shows TM-167 criterion 2 on real tmux.**
- **Setup:** five concurrent `startup-check --source hook` calls, from a main checkout and three
  linked worktrees of one enrolled repository.
- **Result:**
  - exactly one supervisor;
  - that supervisor created one managed lead and proved it responsive (recovery `reused`,
    `attempts` 0);
  - one lead session on the server, and one registration;
  - still exactly one supervisor, one session and an unchanged binding after further ticks and
    later session starts.

**Suites not run here.** The integration worktree has no `node_modules`, so the dependency-backed
unit suites and `build:check` run in the main checkout after the merge.

## Evidence from each worker

- `TM-167-W3-ACTIVATION.md`
- `TM-167-W4-RECOVERY.md`
- `TM-164-W1-…`: earlier work, not relevant here
- `TM-168-W5-SURFACES.md`
- `TM-185-LEAD-RUN-ICON.md`
- W6's report, recorded under TM-168 as `PRESENCE-ROLE-ICON-ADDENDUM.md` §10 and the fixtures

## Follow-ups filed during this work

| Task | Problem |
|---|---|
| TM-181 | The stability harness passes empty runs. |
| TM-182 | A stale signed hash for the header addendum. |
| TM-183 | `roleName` carries escape characters unsanitised. |
| TM-184 | `topology-launch` tests touch the operator's tmux server when `TMUX` is inherited. |
| TM-186 | `supervise` may keep running after it retires. |
