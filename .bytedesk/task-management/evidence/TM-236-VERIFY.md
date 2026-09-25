# TM-236 — a dispatched worker reads its own worker-bound record as itself

Date: 2026-09-24. Branch `tm/TM-236-task-management-agent-orchestration-a-dispatched`, base `25bd49b`.
Verified from inside a dispatched worker (tmux pane `%897`, claude pid 640548), which is the
reader this task is about.

## Root cause

`ao-topology manage start-worker` dispatches, then `bindTaskWorker` records a `worker-bound` event
on the task through `tm comment`, naming the worker's tmux session, pane and pane pid. The worker's
environment carried only `TM_DISPATCH_WORKER/_TASK/_BRANCH/_INTEGRATION_BRANCH`: no run, pane or
pid. `tm show` printed that event as any other comment (and did not print `dispatched` in text at
all). Gateway TM-455 read its own record and exited.

## What changed

- `TM_DISPATCH_RUN` pinned into the worker env: tmux backend (`tmux:tm-<id>`, known before spawn)
  and ao-topology's launcher (`topology:<session>`). The detached pool strips it with the other
  markers.
- One predicate, `task-management/lib/dispatch/self.mjs` (`isSelf`): a record is self when it names
  the caller's run (`TM_DISPATCH_RUN`), pane (`TMUX_PANE`) or a pid in the caller's process
  ancestry (`/proc` walk; the pane process is an ancestor of every `tm` the worker runs; pid 1 is
  excluded). `TM_SESSION_ID` is not a signal: the lead that dispatched the worker shares it.
- Surfaces: `tm show` prints `dispatched:` in text and marks it and `worker-bound` /
  `worker-started` comments (`self: true` in `--json`); `tm agent list` marks the registry row;
  `ao-topology manage status` reports `management.worker.self` (same predicate, `workerIsSelf`).
- Handoff: a `## You are the dispatched worker` section ("You are the bound worker for <id> …")
  before `## When you finish`; the SubagentStart worker brief carries the same sentence.
- CHANGELOG entries in both plugins name gateway TM-455.

## Verification

Every run below was executed with this shell's own worker markers stripped
(`env -u TM_DISPATCH_* -u TM_SESSION_ID -u TM_ACTOR -u TM_ROOT`), because the suite reads them.

| check | command | result |
|---|---|---|
| tm unit suite | `node --test task-management/tests/unit/*.test.mjs` | tests 1555, pass 1555, fail 0 |
| tm bash contract suites | `bash task-management/run-tests.sh contract` | 12 suites, 579 passed, 0 failed, exit 0 |
| ao topology unit files | `node --test --test-concurrency=1 tests/unit/topology-*.test.mjs` | tests 509, pass 509, fail 0, exit 0 |

New tests (`task-management/tests/unit/dispatch-self.test.mjs`, 9 tests) drive the real `tm`
binary as a child of the test process, which stands in for the worker's harness:

- a `worker-bound` comment naming the harness pid (an ancestor of `tm`) → `comments[1].self ===
  true` in `--json`, exactly one `← self` line in text, and it is the `worker-bound` line;
- the same record naming a different live pid (a spawned sleeper) → no `self`, no mark;
- `TMUX_PANE` matching the bound pane, or `TM_DISPATCH_RUN` matching the run, marks the record
  even when the pid is another's;
- `tm agent list` marks the row whose pid is the caller and not the row whose pid is the sleeper;
- the tmux backend argv carries `-e TM_DISPATCH_RUN=tmux:tm-TM-001` and reports that run;
- the handoff contains `You are the bound worker for TM-nnn.` before `## When you finish`.

ao (`topology-management.test.mjs`): the production-proof test now asserts `manage status` reports
`worker.self === false` for the bound child process and `true` when read with the worker's own
`TM_DISPATCH_RUN`; a new unit test covers run, pane, own pid, ancestor pid, a topology member pane,
and a different live pid.

### Live, from this pane (real store, real record)

```
$ node task-management/bin/tm show TM-236 | grep ^dispatched
dispatched: tmux run=tmux:tm-TM-236 session=40645e47-…            # no mark: this worker predates the change, so it has no TM_DISPATCH_RUN
$ TM_DISPATCH_RUN=tmux:tm-TM-236 node task-management/bin/tm show TM-236 | grep ^dispatched
dispatched: tmux run=tmux:tm-TM-236 session=40645e47-… ← self: this names your own run/pane/pid — you are the bound worker, not a second one
$ TM_DISPATCH_RUN=tmux:tm-TM-236 node task-management/bin/tm agent list | grep TM-236
alive   agent:TM-236-40645e47  backend=tmux  run=tmux:tm-TM-236  …  (self — this is you)
$ TM_DISPATCH_RUN=tmux:tm-TM-234 node task-management/bin/tm show TM-236 | grep -c "← self"
0                                                                  # control: another task's run id marks nothing
```

### Pre-existing failures, not this change

With this shell's worker markers present, 9 tests in `actor`, `mcp-claims`, `mcp` and `session-id`
fail. They fail identically (same 9) at base commit `25bd49b` in a clean detached worktree with the
same environment, and pass 58/58 in this tree with the markers stripped. They read the ambient
session identity; they are environmental.

### A check that failed and what it found

The first `markSelf` fixture named pane pid `1`; the ancestry walk reached init and read it as
self. Fixed by excluding pid 1 from the ancestry in both copies of the predicate; the fixture now
uses a live non-ancestor pid.

## Not verified here

A fresh `ao-topology manage start-worker --backend tmux` end to end on this machine, which would
need an admitted governed task and a live lead. The tmux env path is covered by the argv test and by
the live `tm show` run above with the run id set; the topology launcher change is one env key
beside the three that already reach the pane the same way.

## Criterion 5 — plugin independence (2026-09-25)

Commit base `7037f98`; tree dirty only with this change plus the pre-existing `.claude/settings.json`
and `opencode.json`. Tests run with this shell's `TM_DISPATCH_*`, `TM_SESSION_ID`, `TMUX` and
`TMUX_PANE` cleared — this session is itself a dispatched worker, and with them present `tm govern`
refuses inside the ao fixtures (4 failures, identical on a clean detached worktree at `7037f98`).

- No import crosses the boundary in shipped code: 0 matches across `task-management/{lib,bin}` and
  `agent-orchestration/{topology,src,bin}`. The same grep finds 4 in `agent-orchestration/tests`
  (fixtures), so it can find one.
- No manifest dependency: neither `.claude-plugin/plugin.json` mentions one.
- ao side: `taskStore` now checks the `tm` launcher exists (`TOPOLOGY_MANAGEMENT_TM_ABSENT`), and
  `managementStatus` skips the task and claim on that code. New assertion in the production-proof test:
  status with a non-existent `tmBin` returns `task: null`, `claim: null`, `worker.self: true`. The same
  test file on clean `7037f98` fails with `spawn …/no-task-management/tm ENOENT` — the check can fail.
  `topology-*.test.mjs`: 509/509 pass.
- tm side: new test runs `tm show --json` with `PATH` of node's dir, `/usr/bin`, `/bin`, first asserting
  `command -v ao-topology` fails there; the dispatched record and both events are still `self: true`.
  `dispatch*.test.mjs` + `pool-ensure.test.mjs`: 124/124 pass.
