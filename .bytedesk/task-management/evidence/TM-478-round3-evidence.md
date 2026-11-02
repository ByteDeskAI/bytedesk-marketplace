# TM-478 round 3 — evidence at 904ecd14a688bd02f45614dd590c738844432dcf

Tree: clean worktree at 904ecd14a688bd02f45614dd590c738844432dcf (graft wiring noise reverted before measuring), branch pushed, PR #242.

## Lead brief (A): shared-waiter race
- lead.mjs: the consuming waiter records the memo INSIDE the probe lock, BEFORE removing probe and ack;
  no current()/rememberAck after the lock. lateAck confirms the incarnation, records, then removes.
- Test "two waiters on one probe both see the answer even when the consumer stalls after removing it".
  At 1840383b lead.mjs: FAILS, actual [true, false] (tm478-old.log). At 904ecd14a688bd02f45614dd590c738844432dcf: passes 5/5 repeated runs.

## Lead brief (B): release on the ack itself
- leadNonceAck records the memo and calls wakeHeldForRepository (held leads_not_ready mail naming the repo).
- Test "an ack with no waiter left still releases held mail after its probe expires": hold, ack with no
  waiter, delete probe+ack, resume -> delivered. At 1840383b: FAILS. At 904ecd14a688bd02f45614dd590c738844432dcf: passes.

## last-probe memo
- Moved to <registry>/probe-state/<agent>.last-probe.json; test asserts nothing named last-probe in probes/.

## Required checks, run exactly as configured on main, at 904ecd14a688bd02f45614dd590c738844432dcf (exits.jsonl)
- agent-orchestration: npm ci: exit 0
- agent-orchestration: unit: exit 0
- agent-orchestration: build:check: exit 0
- task-management: unit: exit 1
- agent-orchestration: plugin validate: exit 0
- task-management: plugin validate: exit 0
- plugin-rsync: tests: exit 0

agent-orchestration unit tail:
```
# tests 1306
# pass 1302
# fail 0
# skipped 4
```
task-management unit tail (exit 1):
```
# tests 1677
# pass 1668
# fail 9
not ok 3 - actor
not ok 236 - tm_task_update start
not ok 238 - tm_claim
not ok 257 - tm_worktree new claims and provisions, rm releases and removes, list reads — and refuses a held task
not ok 424 - the event log's session column
```

## Why task-management: unit exits 1 — host env, not this change
- This PR changes nothing under task-management/ (git diff origin/main...HEAD -- task-management is empty).
- Clean origin/main (e75402ed) with the same configured argv in this session: 1669 pass / 9 fail, same tests (tm478-main-tm.log).
- The configured argv does not unset TM_SESSION_ID. Additionally unsetting it: origin/main 1678/0
  (tm478-main-tm-nosess.log); 904ecd14a688bd02f45614dd590c738844432dcf 1677/0 (task-management-unit-no-TM_SESSION_ID.log).
- Bisected: unsetting TM_SESSION_ID alone fixes the claim tests; unsetting CLAUDE_CODE_SESSION_ID alone does not.
- Fix belongs in management.required_checks (add -u TM_SESSION_ID); not changed from a worker branch.
