# TM-521 verification at 59a5d71f583dde79d97873b2e7c22750316c7d89

## worker-guard suite (26/26)
```
# \# pre-bash inside a worker, binaries that ran: ["node /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-521-task-management-worker-guard-the-stale-integrati/task-management/bin/tm-hook pre-bash"]
    # Subtest: TM-521: a tm block reason that quotes a refused command is data, and the command itself is still refused
    ok 3 - TM-521: a tm block reason that quotes a refused command is data, and the command itself is still refused
# tests 26
# pass 26
# fail 0
```

Red/green: on the pre-fix worker-guard.mjs the TM-521 test fails — `$TM block TM-262 "…gh pr create --base main…"` refused by unparsed. With the fix it passes.

## required checks at 59a5d71f583dde79d97873b2e7c22750316c7d89 (run inside a dispatched worker env)
```
ao-npm-ci exit=0
ao-unit exit=1
ao-build-check exit=0
tm-unit exit=1
ao-validate exit=0
tm-validate exit=0
```

Both unit failures are pre-existing (TM-306): origin/main fails a superset of the same task-management tests in the same env (16 vs 15). Unset TM_DISPATCH_*: 9 fail, all session-identity tests (actor, tm_claim, tm_task_update start, tm_worktree, event-log session column) — none in worker-guard.
