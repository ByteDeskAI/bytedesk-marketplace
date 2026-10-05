# TM-238 verification — 2026-09-24T23:31:05Z

Worktree: /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-238-task-management-collect-re-records-a-ready-for-r
Commit under test: a341204 + uncommitted TM-238 edits (task-management/lib/dispatch/collect.mjs, lib/doctor.mjs, tests, CHANGELOG)

## Focused unit run (result, doctor, pool, pool-safety, governance, dispatch-idle)
```
# tests 167
# pass 165
# fail 2
```
Failures are the two 'handoff completion contract' subtests, which fail identically at HEAD in a clean detached control worktree (see below).

## New tests (all pass)
```
    ok 1 - names the repeats; --fix keeps the first in place and leaves people's repeats alone
ok 112 - duplicate worker comments (TM-238)
    ok 1 - collects an exited ready-for-review worker once; the next tick writes nothing
    ok 2 - keys on the run: a re-dispatch of the same task is collected once more
    ok 3 - guards every outcome, not only review: the same done run records once
ok 393 - recordResult — one result per dispatch run (TM-238)
```

## Full unit suite, this tree vs clean control at HEAD (a341204)
```
mine:    # tests 1537 # pass 1524 # fail 13 
control: # tests 1533 # pass 1520 # fail 13 

failing test names, control vs mine (diff ignoring the ordinal):
IDENTICAL — 13 pre-existing failures, 0 introduced
```

## Pool contract suite
```

34 passed, 0 failed
```

## Live one-off cleanup (targeted repair of duplicate-worker-comments only)
```
store: /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace
findings: [
  'TM-217: 127 repeated worker comments — the same result was recorded more than once (TM-238)',
  'TM-234: 123 repeated worker comments — the same result was recorded more than once (TM-238)'
]
before  TM-217 worker:tmux comments: 128  TM-234: 124
dropped 127 repeated worker comments from TM-217, keeping the first
dropped 123 repeated worker comments from TM-234, keeping the first
after   TM-217 worker:tmux comments: 1  TM-234: 1
remaining: 0
```
Note: the running pool (pid 2960809, main checkout code) still re-records every 30s until this fix is on main and the pool is restarted; re-run `tm doctor --fix` after that.
