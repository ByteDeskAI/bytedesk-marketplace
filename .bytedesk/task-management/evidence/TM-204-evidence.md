# TM-204 — evidence

Commit under test: `16804b6` plus this branch's five test-file changes.
Working tree at every measurement below: only the five files this task changed, plus
`.claude/settings.json`, which the graft tool rewrote during the session and which is NOT part of
this change and NOT committed here.

## 1. The failure, reproduced before the fix

Ambient store = this repo's own, whose `dispatch.backends` the lead had set to `["tmux","manual"]`
while working around TM-198.

```
$ node --test --test-concurrency=1 task-management/tests/unit/dispatch-surfaces.test.mjs
# tests 15
# pass 14
# fail 1
not ok 6 - a supplied registry participates in selection
  not ok 2 - keeps an overridden name in its configured place rather than promoting it
```

No code changed to make it red. `resolveBackend({ registry, caps: {} })` defaults `p` to `paths()`,
`backendOrder(p)` read `["tmux","manual"]`, so both `topology` and `fake` were absent from the
configured order, the registry's own key order decided the walk, and `topology` won.

## 1b. The control, in a scratch store — the pre-fix test made red on demand

`git show HEAD:…/dispatch-surfaces.test.mjs` restored as a temporary file, run against two scratch
stores that differ in one key:

| test version | scratch store `dispatch.backends` | result |
|---|---|---|
| pre-fix | `["manual"]` | 14 pass / **1 fail** — "keeps an overridden name in its configured place" |
| pre-fix | absent | 15 pass / 0 fail |
| post-fix | `["manual"]` | 15 pass / 0 fail |
| post-fix | absent | 15 pass / 0 fail |

The pre-fix test's verdict is a function of a config file it never mentions. The post-fix test's is
not. The temporary control file was deleted after the run.

## 2. The audit — every ambient read in the suite

| site | ambient thing it read | disposition |
|---|---|---|
| `dispatch-surfaces.test.mjs:268,279` | `paths()` → project `dispatch.backends` | owns a store; order pinned AND asserted |
| `worker-guard.test.mjs` first `envWith()` | `TM_ROOT` → the developer's board | merged with its sibling, which already stripped `TM_ROOT` |
| `dispatch.test.mjs:243,277` | shared `/tmp/none` | owned temp store |
| `dispatch-backends.test.mjs:461` | shared `/tmp/tm-resolve-backend-none` | owned temp store |
| `hostcaps.test.mjs:175-183` | the real host, via no-args `detectHostCaps()` | documented host-dependent; asserts memoization only, never a capability value |
| `worktree.test.mjs:31` | `paths("/tmp/proj")` | not a read — pure path-string construction, no file touched |

Every other subprocess in the suite already sets `TM_ROOT: p.root` explicitly.

The `worker-guard.test.mjs` finding was NOT in the original report. It is the same defect in a
second file: `TM-001` is this file's fixture id and also a real task in this repo's store, which is
`done`, so the guard-release path fired and two tests asserting the guard HELD got exit 0.

## 3. Verification — the suite under three different ambient stores

Session env normalised (`TM_SESSION_ID`, `TM_ACTOR`, `TM_DISPATCH_*`, `CLAUDE_CODE_SESSION_ID`,
`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION` unset), because those are a separate defect — see §4.

| ambient `dispatch.backends` | store | result | exit |
|---|---|---|---|
| `["tmux","manual"]` (SET — the value that caused the bug) | this repo's own | 1506 pass / 0 fail | 0 |
| absent (UNSET) | scratch `/tmp/tm204/store-unset` | 1506 pass / 0 fail | 0 |
| `["manual"]` (hostile: neither `topology` nor `fake` in the order) | scratch `/tmp/tm204/store-hostile` | 1506 pass / 0 fail | 0 |

Three different ambient configs, one verdict. Before the fix the first of these was 1493/13 and the
second 1506/0 — the divergence is what the task was filed about, and it is gone.

## 4. What this does NOT fix, and why

Run D: the same suite under this session's REAL environment — a dispatched pool worker, so
`TM_SESSION_ID=pool-tm-204`, `TM_ACTOR=pool`, `TM_DISPATCH_WORKER=1` are exported into every test.

```
# tests 1506
# pass 1495
# fail 11
```

All 11 are session-env leakage, not store leakage: `actor` infers `pool-tm-204` as the subagent id,
and the claims / `tm_claim` / `tm_task_update` / `tm_worktree` / handoff / event-session tests read
the runner's live session instead of their fixture. They are a distinct class from this task's
acceptance criteria (`resolveBackend`, `detectHostCaps`, `config()` without explicit paths) and the
two in `worker-guard.test.mjs` that WERE store-class are fixed here. Filed separately — the suite is
green in a normal shell and red only when run from inside a dispatched worker.
