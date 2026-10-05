TM-235 evidence — focused test run (dispatch.test.mjs, result.test.mjs, worker-guard.test.mjs, agent-first-docs.test.mjs), env cleared of TM_DISPATCH_* to avoid this session's own dispatch-worker env leaking in.

The 2 failing subtests (worker-guard.test.mjs: 'in a worker, exits 2 with a reason for one sample of every row...' and 'in a worker without TM_DISPATCH_BRANCH...') are PRE-EXISTING on main, unrelated to this change — verified by running the identical suite against the code stashed back to its pre-TM-235 state (same 2 failures, same names, before any of this task's edits).

Full unrelated-plugin-suite run: 1530 pass / 11 fail, vs. baseline 1522 pass / 11 fail — same 11 pre-existing failures, 8 new tests added by this task all passing.

---
TAP version 13
# Subtest: agent-first documentation (TM-074)
    # Subtest: README links docs/agent-first.md and names the four harnesses
    ok 1 - README links docs/agent-first.md and names the four harnesses
      ---
      duration_ms: 1.069721
      type: 'test'
      ...
    # Subtest: docs/agent-first.md covers every agent-first CLI verb, flags, and refusals
    ok 2 - docs/agent-first.md covers every agent-first CLI verb, flags, and refusals
      ---
      duration_ms: 0.350884
      type: 'test'
      ...
    # Subtest: parity table lists all 39 MCP tools and the HTTP twins for dispatch/collect/caps/agents
    ok 3 - parity table lists all 39 MCP tools and the HTTP twins for dispatch/collect/caps/agents
      ---
      duration_ms: 0.416125
      type: 'test'
      ...
    # Subtest: the agent-first docs describe computed readiness and the human veto
    ok 4 - the agent-first docs describe computed readiness and the human veto
      ---
      duration_ms: 0.734367
      type: 'test'
      ...
    # Subtest: the agent-first docs describe the pool as on by default, with a brake
    ok 5 - the agent-first docs describe the pool as on by default, with a brake
      ---
      duration_ms: 0.450849
      type: 'test'
      ...
    # Subtest: the agent-first docs describe the worker guard and the PR finish line
    ok 6 - the agent-first docs describe the worker guard and the PR finish line
      ---
      duration_ms: 1.430877
      type: 'test'
      ...
    # Subtest: no doc still calls the pool opt-in, or the triage label hand-applied
    ok 7 - no doc still calls the pool opt-in, or the triage label hand-applied
      ---
      duration_ms: 2.530199
      type: 'test'
      ...
    # Subtest: skills cross-link dispatch → pool → collect → events
    ok 8 - skills cross-link dispatch → pool → collect → events
      ---
      duration_ms: 1.004299
      type: 'test'
      ...
    1..8
ok 1 - agent-first documentation (TM-074)
  ---
  duration_ms: 8.997985
  type: 'suite'
  ...
# Subtest: dispatch — the happy path
    # Subtest: claims, starts, provisions, hands off and records the run
    ok 1 - claims, starts, provisions, hands off and records the run
      ---
      duration_ms: 139.582985
      type: 'test'
      ...
    # Subtest: refuses a task that is already done
    ok 2 - refuses a task that is already done
      ---
      duration_ms: 42.799351
      type: 'test'
      ...
    # Subtest: refuses an id that does not exist
    ok 3 - refuses an id that does not exist
      ---
      duration_ms: 23.448089
      type: 'test'
      ...
    1..3
ok 2 - dispatch — the happy path
  ---
  duration_ms: 206.658481
  type: 'suite'
  ...
# Subtest: dispatch — the PR base is always resolved, never left implicit
    # Subtest: resolves an unconfigured integration branch to the main checkout's own branch name
    ok 1 - resolves an unconfigured integration branch to the main checkout's own branch name
      ---
      duration_ms: 118.018443
      type: 'test'
      ...
    # Subtest: uses the configured integration branch when one is set
    ok 2 - uses the configured integration branch when one is set
      ---
      duration_ms: 108.013361
      type: 'test'
      ...
    # Subtest: refuses rather than dispatch a worker with no resolvable PR base
    ok 3 - refuses rather than dispatch a worker with no resolvable PR base
      ---
      duration_ms: 38.346888
      type: 'test'
      ...
    1..3
ok 3 - dispatch — the PR base is always resolved, never left implicit
  ---
  duration_ms: 264.828838
  type: 'suite'
  ...
# Subtest: dispatch — refusals leave nothing behind
    # Subtest: propagates the holder-named claim refusal verbatim and creates nothing
    ok 1 - propagates the holder-named claim refusal verbatim and creates nothing
      ---
      duration_ms: 47.546593
      type: 'test'
      ...
    # Subtest: releases the claim and keeps the task open when spawn fails
    ok 2 - releases the claim and keeps the task open when spawn fails
      ---
      duration_ms: 120.631359
      type: 'test'
      ...
    # Subtest: recovers the same way when provisioning throws
    ok 3 - recovers the same way when provisioning throws
      ---
      duration_ms: 156.596617
      type: 'test'
      ...
    1..3
ok 4 - dispatch — refusals leave nothing behind
  ---
  duration_ms: 325.256613
  type: 'suite'
  ...
# Subtest: dispatch — re-dispatch of a live worker
    # Subtest: refuses a same-session re-dispatch and leaves the live claim and status untouched
    ok 1 - refuses a same-session re-dispatch and leaves the live claim and status untouched
      ---
      duration_ms: 124.768488
      type: 'test'
      ...
    # Subtest: re-dispatches cleanly once the claim is gone (the collect-then-redispatch flow)
    ok 2 - re-dispatches cleanly once the claim is gone (the collect-then-redispatch flow)
      ---
      duration_ms: 242.974826
      type: 'test'
      ...
    # Subtest: --steal cannot start a second writer in a live task checkout
    ok 3 - --steal cannot start a second writer in a live task checkout
      ---
      duration_ms: 117.601274
      type: 'test'
      ...
    1..3
ok 5 - dispatch — re-dispatch of a live worker
  ---
  duration_ms: 485.590392
  type: 'suite'
  ...
# Subtest: backend resolution
    # Subtest: walks the configured order, skipping absent and unavailable backends
    ok 1 - walks the configured order, skipping absent and unavailable backends
      ---
      duration_ms: 114.922419
      type: 'test'
      ...
    # Subtest: reports why each skipped backend lost
    ok 2 - reports why each skipped backend lost
      ---
      duration_ms: 0.432274
      type: 'test'
      ...
    # Subtest: honours an explicit backend request and refuses if it is unavailable, before claiming
    ok 3 - honours an explicit backend request and refuses if it is unavailable, before claiming
      ---
      duration_ms: 41.643388
      type: 'test'
      ...
    # Subtest: defaults to the documented order when config says nothing
    ok 4 - defaults to the documented order when config says nothing
      ---
      duration_ms: 0.724922
      type: 'test'
      ...
    # Subtest: fleet is gone — not in the order, and not loadable as a module
    ok 5 - fleet is gone — not in the order, and not loadable as a module
      ---
      duration_ms: 0.178729
      type: 'test'
      ...
    1..5
ok 6 - backend resolution
  ---
  duration_ms: 158.22789
  type: 'suite'
  ...
# Subtest: tmux backend
    # Subtest: is available exactly when caps say tmux is
    ok 1 - is available exactly when caps say tmux is
      ---
      duration_ms: 0.124219
      type: 'test'
      ...
    # Subtest: builds an argv-only spawn: no shell, no shell string, prompt as one positional
    ok 2 - builds an argv-only spawn: no shell, no shell string, prompt as one positional
      ---
      duration_ms: 0.815669
      type: 'test'
      ...
    # Subtest: reports tmux's failure instead of claiming a run
    ok 3 - reports tmux's failure instead of claiming a run
      ---
      duration_ms: 0.373218
      type: 'test'
      ...
    # Subtest: TM-177: marks the pane as a dispatch worker and carries the guard hook on the command line
    ok 4 - TM-177: marks the pane as a dispatch worker and carries the guard hook on the command line
      ---
      duration_ms: 0.252479
      type: 'test'
      ...
    # Subtest: TM-177: a configured tmuxCommand keeps the worker env; --settings rides only on claude
    ok 5 - TM-177: a configured tmuxCommand keeps the worker env; --settings rides only on claude
      ---
      duration_ms: 1.138698
      type: 'test'
      ...
    1..5
ok 7 - tmux backend
  ---
  duration_ms: 2.85118
  type: 'suite'
  ...
# Subtest: manual backend
    # Subtest: is always available and returns paste-able commands, launching nothing
    ok 1 - is always available and returns paste-able commands, launching nothing
      ---
      duration_ms: 0.732175
      type: 'test'
      ...
    1..1
ok 8 - manual backend
  ---
  duration_ms: 0.787386
  type: 'suite'
  ...
# Subtest: recordResult — the done report must be true
    # Subtest: records a genuine done: the worker closed through the gates
    ok 1 - records a genuine done: the worker closed through the gates
      ---
      duration_ms: 42.990265
      type: 'test'
      ...
    # Subtest: downgrades a done report when the task is not done — the AC gate is the gate
    ok 2 - downgrades a done report when the task is not done — the AC gate is the gate
      ---
      duration_ms: 42.348283
      type: 'test'
      ...
    1..2
ok 9 - recordResult — the done report must be true
  ---
  duration_ms: 85.99717
  type: 'suite'
  ...
# Subtest: recordResult — blocked and failed park, never strand
    # Subtest: blocked parks with the summary as the reason and releases the claim
    ok 1 - blocked parks with the summary as the reason and releases the claim
      ---
      duration_ms: 33.993606
      type: 'test'
      ...
    # Subtest: failed parks the same way, with a fallback reason when the summary is empty
    ok 2 - failed parks the same way, with a fallback reason when the summary is empty
      ---
      duration_ms: 29.483089
      type: 'test'
      ...
    # Subtest: does not re-park a task that already left in_progress
    ok 3 - does not re-park a task that already left in_progress
      ---
      duration_ms: 29.697274
      type: 'test'
      ...
    1..3
ok 10 - recordResult — blocked and failed park, never strand
  ---
  duration_ms: 93.551896
  type: 'suite'
  ...
# Subtest: recordResult — refusals and garbage
    # Subtest: refuses a task that does not exist
    ok 1 - refuses a task that does not exist
      ---
      duration_ms: 1.329581
      type: 'test'
      ...
    # Subtest: refuses a task that was never dispatched
    ok 2 - refuses a task that was never dispatched
      ---
      duration_ms: 13.062483
      type: 'test'
      ...
    # Subtest: refuses an outcome it does not know, changing nothing
    ok 3 - refuses an outcome it does not know, changing nothing
      ---
      duration_ms: 22.565221
      type: 'test'
      ...
    # Subtest: never throws, on any garbage
    ok 4 - never throws, on any garbage
      ---
      duration_ms: 0.890599
      type: 'test'
      ...
    1..4
ok 11 - recordResult — refusals and garbage
  ---
  duration_ms: 38.308161
  type: 'suite'
  ...
# Subtest: collectTmux — the session is the liveness signal
    # Subtest: asks argv-only, and a live session means pending — nothing to record
    ok 1 - asks argv-only, and a live session means pending — nothing to record
      ---
      duration_ms: 24.090178
      type: 'test'
      ...
    # Subtest: session gone + task done = done
    ok 2 - session gone + task done = done
      ---
      duration_ms: 26.857964
      type: 'test'
      ...
    # Subtest: session gone + still in_progress = the worker walked away
    ok 3 - session gone + still in_progress = the worker walked away
      ---
      duration_ms: 32.362769
      type: 'test'
      ...
    # Subtest: a tmux that cannot run is a reason, not a throw
    ok 4 - a tmux that cannot run is a reason, not a throw
      ---
      duration_ms: 20.559065
      type: 'test'
      ...
    1..4
ok 12 - collectTmux — the session is the liveness signal
  ---
  duration_ms: 104.054284
  type: 'suite'
  ...
# Subtest: collectOrchestration — against the fake MCP server
    # Subtest: a terminal succeeded run records done, with the run's output as the summary
    ok 1 - a terminal succeeded run records done, with the run's output as the summary
      ---
      duration_ms: 59.460471
      type: 'test'
      ...
    # Subtest: a live run is pending — collection is a read, not a wait
    ok 2 - a live run is pending — collection is a read, not a wait
      ---
      duration_ms: 53.51428
      type: 'test'
      ...
    # Subtest: a terminal failed run on an open task parks it
    ok 3 - a terminal failed run on an open task parks it
      ---
      duration_ms: 66.493325
      type: 'test'
      ...
    # Subtest: asks with the same consumer the dispatch spawned with, not the repo root
    ok 4 - asks with the same consumer the dispatch spawned with, not the repo root
      ---
      duration_ms: 71.171553
      type: 'test'
      ...
    # Subtest: falls back to the repo root when the task carries no worktree
    ok 5 - falls back to the repo root when the task carries no worktree
      ---
      duration_ms: 75.132185
      type: 'test'
      ...
    # Subtest: an unavailable backend is a refusal, not a spawn
    ok 6 - an unavailable backend is a refusal, not a spawn
      ---
      duration_ms: 24.890676
      type: 'test'
      ...
    1..6
ok 13 - collectOrchestration — against the fake MCP server
  ---
  duration_ms: 351.229322
  type: 'suite'
  ...
# Subtest: collectTopology — exact native workflow observation
    # Subtest: asks the producer about the durable record, never a bare tmux name
    ok 1 - asks the producer about the durable record, never a bare tmux name
      ---
      duration_ms: 32.783298
      type: 'test'
      ...
    # Subtest: collects only after exact observation proves native members ended
    ok 2 - collects only after exact observation proves native members ended
      ---
      duration_ms: 80.365321
      type: 'test'
      ...
    # Subtest: holds unknown server/pane incarnations and mismatched native IDs without releasing ownership
    ok 3 - holds unknown server/pane incarnations and mismatched native IDs without releasing ownership
      ---
      duration_ms: 30.607142
      type: 'test'
      ...
    # Subtest: holds legacy records until native import and rejects another backend handle
    ok 4 - holds legacy records until native import and rejects another backend handle
      ---
      duration_ms: 51.491212
      type: 'test'
      ...
    # Subtest: recovers an exact legacy producer reference and records its durable native handle
    ok 5 - recovers an exact legacy producer reference and records its durable native handle
      ---
      duration_ms: 75.839688
      type: 'test'
      ...
    # Subtest: reconciles a live legacy path until the producer moves its terminal record
    ok 6 - reconciles a live legacy path until the producer moves its terminal record
      ---
      duration_ms: 79.658679
      type: 'test'
      ...
    # Subtest: holds missing, ambiguous, rejected and foreign legacy references without observing or releasing a worker
    ok 7 - holds missing, ambiguous, rejected and foreign legacy references without observing or releasing a worker
      ---
      duration_ms: 85.678324
      type: 'test'
      ...
    1..7
ok 14 - collectTopology — exact native workflow observation
  ---
  duration_ms: 436.867707
  type: 'suite'
  ...
# Subtest: collect — the dispatched record is the routing table
    # Subtest: routes on task.dispatched.backend
    ok 1 - routes on task.dispatched.backend
      ---
      duration_ms: 25.657261
      type: 'test'
      ...
    # Subtest: refuses a task that was never dispatched
    ok 2 - refuses a task that was never dispatched
      ---
      duration_ms: 12.912297
      type: 'test'
      ...
    # Subtest: refuses a backend with no collector — manual work has no worker to hear from
    ok 3 - refuses a backend with no collector — manual work has no worker to hear from
      ---
      duration_ms: 22.692989
      type: 'test'
      ...
    # Subtest: never throws on garbage
    ok 4 - never throws on garbage
      ---
      duration_ms: 0.680228
      type: 'test'
      ...
    1..4
ok 15 - collect — the dispatched record is the routing table
  ---
  duration_ms: 62.161949
  type: 'suite'
  ...
# Subtest: the handoff's completion contract
    # Subtest: tells a ready-for-agent worker exactly how to finish
    ok 1 - tells a ready-for-agent worker exactly how to finish
      ---
      duration_ms: 14.727255
      type: 'test'
      ...
    # Subtest: tells the worker to commit, push its own branch, and open a PR titled with the TM key
    ok 2 - tells the worker to commit, push its own branch, and open a PR titled with the TM key
      ---
      duration_ms: 21.653714
      type: 'test'
      ...
    # Subtest: says to block, not close, when the push or the PR fails
    ok 3 - says to block, not close, when the push or the PR fails
      ---
      duration_ms: 16.130025
      type: 'test'
      ...
    # Subtest: names a generic tm/ branch when the task records none, rather than a broken command
    ok 4 - names a generic tm/ branch when the task records none, rather than a broken command
      ---
      duration_ms: 11.582605
      type: 'test'
      ...
    # Subtest: states the configured integration branch as the PR's --base
    ok 5 - states the configured integration branch as the PR's --base
      ---
      duration_ms: 11.044834
      type: 'test'
      ...
    # Subtest: says nothing about it for a task a human is picking up
    ok 6 - says nothing about it for a task a human is picking up
      ---
      duration_ms: 20.366008
      type: 'test'
      ...
    1..6
ok 16 - the handoff's completion contract
  ---
  duration_ms: 95.774013
  type: 'suite'
  ...
# Subtest: the done path records the pull request (TM-180)
    # Subtest: records the PR url on the task when gh finds one
    ok 1 - records the PR url on the task when gh finds one
      ---
      duration_ms: 33.672826
      type: 'test'
      ...
    # Subtest: records it once, however many times the task is collected
    ok 2 - records it once, however many times the task is collected
      ---
      duration_ms: 36.559237
      type: 'test'
      ...
    # Subtest: still collects when gh is not installed
    ok 3 - still collects when gh is not installed
      ---
      duration_ms: 24.780202
      type: 'test'
      ...
    # Subtest: records nothing when there is no PR for the branch, or gh errors
    ok 4 - records nothing when there is no PR for the branch, or gh errors
      ---
      duration_ms: 52.295221
      type: 'test'
      ...
    # Subtest: does not ask gh at all for a task with no branch, or an outcome that is not done
    ok 5 - does not ask gh at all for a task with no branch, or an outcome that is not done
      ---
      duration_ms: 60.379296
      type: 'test'
      ...
    1..5
ok 17 - the done path records the pull request (TM-180)
  ---
  duration_ms: 207.953691
  type: 'suite'
  ...
# \# worker-guard: 29 rows, 84 blocked samples
# \# pre-bash outside a worker, binaries that ran: []
# \# pre-bash inside a worker, binaries that ran: ["node /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-235-task-management-dispatched-workers-open-prs-agai/task-management/bin/tm-hook pre-bash"]
# Subtest: guardCommand — the table
    # Subtest: every row has blocked samples, and each sample is blocked by THAT row
    ok 1 - every row has blocked samples, and each sample is blocked by THAT row
      ---
      duration_ms: 7.256495
      type: 'test'
      ...
    # Subtest: allows the finish line and ordinary work
    ok 2 - allows the finish line and ordinary work
      ---
      duration_ms: 1.807852
      type: 'test'
      ...
    1..2
ok 18 - guardCommand — the table
  ---
  duration_ms: 10.12632
  type: 'suite'
  ...
# Subtest: guardCommand — TM-235: a PR must target the configured integration branch
    # Subtest: blocks a PR with no --base
    ok 1 - blocks a PR with no --base
      ---
      duration_ms: 0.530805
      type: 'test'
      ...
    # Subtest: blocks a PR based against the wrong branch
    ok 2 - blocks a PR based against the wrong branch
      ---
      duration_ms: 0.226389
      type: 'test'
      ...
    # Subtest: allows a PR based against the configured integration branch
    ok 3 - allows a PR based against the configured integration branch
      ---
      duration_ms: 0.261001
      type: 'test'
      ...
    # Subtest: fails safe when no integration branch is known for this worker
    ok 4 - fails safe when no integration branch is known for this worker
      ---
      duration_ms: 0.231001
      type: 'test'
      ...
    1..4
ok 19 - guardCommand — TM-235: a PR must target the configured integration branch
  ---
  duration_ms: 1.688324
  type: 'suite'
  ...
# Subtest: guardCommand — the shell a worker actually writes
    # Subtest: blocks a guarded command inside compound, wrapped and nested forms
    ok 1 - blocks a guarded command inside compound, wrapped and nested forms
      ---
      duration_ms: 1.582645
      type: 'test'
      ...
    # Subtest: fails safe on what it cannot read, but only when it mentions git push, gh or a guarded tool
    ok 2 - fails safe on what it cannot read, but only when it mentions git push, gh or a guarded tool
      ---
      duration_ms: 0.82025
      type: 'test'
      ...
    # Subtest: a push that relies on HEAD is allowed only while HEAD is the worker's own branch
    ok 3 - a push that relies on HEAD is allowed only while HEAD is the worker's own branch
      ---
      duration_ms: 0.425691
      type: 'test'
      ...
    # Subtest: with no own branch known, every push is refused and ordinary git still runs
    ok 4 - with no own branch known, every push is refused and ordinary git still runs
      ---
      duration_ms: 0.672631
      type: 'test'
      ...
    # Subtest: a rebase that rewrites main is refused; rebasing the own branch onto main is not
    ok 5 - a rebase that rewrites main is refused; rebasing the own branch onto main is not
      ---
      duration_ms: 0.198748
      type: 'test'
      ...
    1..5
ok 20 - guardCommand — the shell a worker actually writes
  ---
  duration_ms: 4.240736
  type: 'suite'
  ...
# Subtest: tm-hook.sh pre-bash — the glue
    # Subtest: outside a worker, exits 0 without starting Node — and the same shim does see Node start inside one
    ok 1 - outside a worker, exits 0 without starting Node — and the same shim does see Node start inside one
      ---
      duration_ms: 25.095584
      type: 'test'
      ...
    # Subtest: in a worker, exits 2 with a reason for one sample of every row, and 0 for the finish line
    not ok 2 - in a worker, exits 2 with a reason for one sample of every row, and 0 for the finish line
      ---
      duration_ms: 79.707778
      type: 'test'
      location: '/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-235-task-management-dispatched-workers-open-prs-agai/task-management/tests/unit/worker-guard.test.mjs:328:3'
      failureType: 'testCodeFailure'
      error: |-
        git-push-force: git push --force origin tm/TM-001-fix-the-thing exits 2 (stderr: )
        
        0 !== 2
        
      code: 'ERR_ASSERTION'
      name: 'AssertionError'
      expected: 2
      actual: 0
      operator: 'strictEqual'
      stack: |-
        TestContext.<anonymous> (file:///home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-235-task-management-dispatched-workers-open-prs-agai/task-management/tests/unit/worker-guard.test.mjs:337:14)
        Test.runInAsyncScope (node:async_hooks:214:14)
        Test.run (node:internal/test_runner/test:1047:25)
        Suite.processPendingSubtests (node:internal/test_runner/test:744:18)
        Test.postRun (node:internal/test_runner/test:1173:19)
        Test.run (node:internal/test_runner/test:1101:12)
        async Promise.all (index 0)
        async Suite.run (node:internal/test_runner/test:1442:7)
        async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
      ...
    # Subtest: in a worker without TM_DISPATCH_BRANCH, the own branch is read from the payload's cwd
    not ok 3 - in a worker without TM_DISPATCH_BRANCH, the own branch is read from the payload's cwd
      ---
      duration_ms: 139.467469
      type: 'test'
      location: '/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-235-task-management-dispatched-workers-open-prs-agai/task-management/tests/unit/worker-guard.test.mjs:350:3'
      failureType: 'testCodeFailure'
      error: |-
        HEAD on main is no own branch at all
        
        0 !== 2
        
      code: 'ERR_ASSERTION'
      name: 'AssertionError'
      expected: 2
      actual: 0
      operator: 'strictEqual'
      stack: |-
        TestContext.<anonymous> (file:///home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-235-task-management-dispatched-workers-open-prs-agai/task-management/tests/unit/worker-guard.test.mjs:360:12)
        Test.runInAsyncScope (node:async_hooks:214:14)
        Test.run (node:internal/test_runner/test:1047:25)
        Suite.processPendingSubtests (node:internal/test_runner/test:744:18)
        Test.postRun (node:internal/test_runner/test:1173:19)
        Test.run (node:internal/test_runner/test:1101:12)
        async Suite.processPendingSubtests (node:internal/test_runner/test:744:7)
      ...
    # Subtest: in a worker, an unreadable payload is refused rather than waved through
    ok 4 - in a worker, an unreadable payload is refused rather than waved through
      ---
      duration_ms: 38.860409
      type: 'test'
      ...
    1..4
not ok 21 - tm-hook.sh pre-bash — the glue
  ---
  duration_ms: 283.399437
  type: 'suite'
  location: '/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-235-task-management-dispatched-workers-open-prs-agai/task-management/tests/unit/worker-guard.test.mjs:278:1'
  failureType: 'subtestsFailed'
  error: '2 subtests failed'
  code: 'ERR_TEST_FAILURE'
  ...
# Subtest: tm-hook.sh pre-bash — the guard releases when the task does
    # Subtest: a done task releases it — the branch is gone and the session still works
    ok 1 - a done task releases it — the branch is gone and the session still works
      ---
      duration_ms: 84.403386
      type: 'test'
      ...
    # Subtest: a deleted task releases it too
    ok 2 - a deleted task releases it too
      ---
      duration_ms: 79.304753
      type: 'test'
      ...
    # Subtest: an open task does NOT release it
    ok 3 - an open task does NOT release it
      ---
      duration_ms: 96.684604
      type: 'test'
      ...
    # Subtest: a task it cannot read does NOT release it — a guard that cannot see must not stand down
    ok 4 - a task it cannot read does NOT release it — a guard that cannot see must not stand down
      ---
      duration_ms: 71.292173
      type: 'test'
      ...
    # Subtest: without TM_ROOT, the task's recorded branch identifies it
    ok 5 - without TM_ROOT, the task's recorded branch identifies it
      ---
      duration_ms: 123.877392
      type: 'test'
      ...
    # Subtest: a same-id task done in ANOTHER store does NOT release it
    ok 6 - a same-id task done in ANOTHER store does NOT release it
      ---
      duration_ms: 117.401869
      type: 'test'
      ...
    # Subtest: no pin at all does NOT release it
    ok 7 - no pin at all does NOT release it
      ---
      duration_ms: 71.082102
      type: 'test'
      ...
    1..7
ok 22 - tm-hook.sh pre-bash — the guard releases when the task does
  ---
  duration_ms: 644.536812
  type: 'suite'
  ...
1..22
# tests 94
# suites 22
# pass 92
# fail 2
# cancelled 0
# skipped 0
# todo 0
# duration_ms 4268.613796


# Round 2 — AC 5, 6, 7 (2026-09-24, commit 22c6e24 on tm/TM-235-task-management-dispatched-workers-open-prs-agai)

Tree: clean at 22c6e24 apart from two unrelated untracked/modified files outside task-management/ (.claude/settings.json, opencode.json), left out of the commit.
Runner shell: a dispatched worker (TM_DISPATCH_WORKER/_TASK/_BRANCH, TM_ROOT, TM_ACTOR, TM_SESSION_ID set). That matters — see the contamination note.

## AC5 — gh pr new is read like gh pr create

```
"gh pr new --title x" -> BLOCK gh-pr-create-base: a dispatch worker opens its PR against main, this repo's configured integration branch — not the repository default. Run `gh pr create --base main ...`.
"gh pr new --base develop --title x" -> BLOCK gh-pr-create-base: a dispatch worker opens its PR against main, this repo's configured integration branch — not the repository default. Run `gh pr create --base main ...`.
"gh pr new --base main --title x" -> ALLOW
```

## AC6 — a PR base cannot be retargeted

```
"gh pr edit 12 --base develop" -> BLOCK gh-pr-retarget
"gh pr edit 12 --title y" -> ALLOW
"gh pr edit 12 --base main" -> ALLOW
"gh api -X PATCH repos/o/r/pulls/12 -f base=develop" -> BLOCK gh-pr-retarget
"gh api repos/o/r/pulls -f title=x -f head=tm/x -f base=develop" -> BLOCK gh-pr-retarget
"gh api -X POST repos/o/r/pulls --input pr.json" -> BLOCK gh-pr-retarget
"gh api -X PATCH repos/o/r/pulls/12 -f title=y" -> ALLOW
"gh api repos/o/r/pulls/12" -> ALLOW
"gh api -X PUT repos/o/r/pulls/1/merge" -> BLOCK gh-api-mutation
```

## AC7 — a stale TM_DISPATCH_INTEGRATION_BRANCH never reaches the prompt

- lib/render.mjs handoff() reads branch and base from the task record only; the env read is gone for both TM_DISPATCH_BRANCH and TM_DISPATCH_INTEGRATION_BRANCH (the sibling had the same defect).
- lib/dispatch/pool.mjs IDENTITY_ENV now strips TM_DISPATCH_INTEGRATION_BRANCH; tests/unit/pool-ensure.test.mjs asserts it with a fake spawnImpl.
- tests/unit/dispatch.test.mjs: 'ignores a stale TM_DISPATCH_INTEGRATION_BRANCH inherited from the dispatching shell' sets the env to stale-from-another-worker, configures develop, dispatches, asserts --base develop in the prompt and the stale value absent.

## Test runs
### The four touched suites, worker env UNSET
```
# \# worker-guard: 30 rows, 93 blocked samples
# tests 106
# pass 106
# fail 0
exit=0
```

### The same four suites, INSIDE this dispatched worker's shell (env as inherited)
```
# \# worker-guard: 30 rows, 93 blocked samples
# tests 106
# pass 106
# fail 0
exit=0
```

At HEAD (3897c1d) the same run inside this shell failed 4: result.test 'tells the worker to commit…' and 'names a generic tm/ branch…' (render preferred the inherited TM_DISPATCH_BRANCH), and worker-guard.test 'in a worker, exits 2…' and 'in a worker without TM_DISPATCH_BRANCH…' (envWith() kept the inherited TM_ROOT, the hook read the real store, found TM-001 done, and released). Both are fixed by this commit; both are the defect AC7 names, wearing the sibling variable.

### Full unit suite, worker env unset
```
# tests 1546
# pass 1546
# fail 0
# cancelled 0
```

Inside the worker shell the full suite fails 8 in actor.test, mcp-claims.test and session-id.test — identical at HEAD in a detached worktree, untouched by this change (they read TM_ACTOR / TM_SESSION_ID). Not fixed here; noted.

### Bash hook suites, worker env unset
```
65 passed, 0 failed
40 passed, 0 failed
```

(An earlier draft of this section recorded exit=1 with no counts: the suite list was passed unquoted under zsh, which does not word-split, so node received one non-existent path. Rule 1 of .claude/rules/verification-that-can-fail.md, caught by its own symptom.)
