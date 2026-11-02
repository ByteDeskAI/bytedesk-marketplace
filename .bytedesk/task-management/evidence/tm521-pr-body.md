## TM-521: a tm block reason that quotes a refused command is allowed (regression test)

### What changed (round 2)

- **Round 1's guard change is removed.** Review (faro, major) found that dropping every quoted argument after an expansion let `$SHELL -c "gh pr merge 5"` through. After merging `main`, TM-481 refuses every expansion-named command outright and reads a spelled-out `tm` line as data, so that exemption was dead code. `worker-guard.mjs` now matches `main` exactly.
- **This PR now adds only a regression test and a CHANGELOG entry.** The test runs the hook's `WORKER` context:
  - Allowed: `.bytedesk/task-management/bin/tm block|comment TM-n "<reason quoting gh pr create / git push>"`.
  - Refused: the quoted commands themselves, `$TM block …`, `$GH pr merge 5`, and the three bypass commands from review.

### How it was verified

- The bypass commands were allowed at 59a5d71f and are refused at 2c55198a (script comparison; table in the evidence).
- Required checks ran at 2c55198a. `npm ci`, `build:check`, both `plugin validate` runs and the `plugin-rsync` tests exit 0.
- Both unit suites exit 1 inside a dispatched worker session. `task-management: unit` fails the **identical** 41-test list on `origin/main` (1c497151): 1661 pass on the branch versus 1660 on main. These are pre-existing failures (TM-306/TM-511).

Evidence: `.bytedesk/task-management/evidence/TM-521-round2.md`

Not covered: the stale integration base (passport TM-262), the first half of audit problem 5. It needs its own task.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
