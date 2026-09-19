# TM-201 — a dispatch branches off a defined base

Commit under test: `d306df2`, the single commit on
`tm/TM-201-task-management-dispatch-branches-a-worker-off-w`, rebased onto `origin/main` (`f89635a`).
Baseline: `origin/main` checked out clean at `/tmp/tm201-base2` (`git worktree add --detach`).
Dirty state of the tree measured: nothing of this change, plus three `.claude/` files another tool
(graft) rewrote and which are **not** part of it.

**The branch was rebased, and that is part of the result.** It was originally cut from the parked
`feat/dispatch-duplicate-guard` — this bug, hitting this task — so its first diff carried 14 of
another session's commits. It was replayed onto `origin/main` (one conflict, in the CHANGELOG's
Unreleased section, resolved by rebuilding that file from `origin/main` plus this entry alone), and
the numbers below were re-measured on the rebased tree. The earlier run against `16804b6` is
discarded rather than reported: it measured a different tree.

## What changed

`lib/worktree.mjs` `createWorktree` defaulted `base` to `"HEAD"`. It now calls a new
`resolveBase(root, {config, requested})`, in order: explicit `--base` → `dispatch.base` in config →
the repo's default branch (`origin/HEAD`, then `origin/main`, `origin/master`, `main`, `master`) →
`HEAD` only as a last resort. One call site: there is exactly one `git worktree add` in the plugin,
so the four callers (`tm worktree new`, `tm dispatch`, `tm_worktree` MCP, the dashboard) all get it.

The resolved `{ref, sha, source}` is recorded on the task, carried on the `dispatched` record, and
printed by `tm show`, `tm worktree new`, the MCP and dashboard responses, the handoff header, and
the `gh pr create --body` the handoff hands the worker.

## 1. The live condition that caused the bug, re-measured

The main checkout is still parked where it was when three workers inherited it:

```
$ node -e '<resolveBase against the real checkout>'
main checkout HEAD is on: feat/dispatch-duplicate-guard
resolveBase: {"ref":"origin/main","sha":"f89635aaa24f16e577dd9a92c9e34eb756908785","source":"default-branch"}
```

Before this change the same call site would have used `HEAD` — `feat/dispatch-duplicate-guard`.

## 2. The new suite, and proof it can report finding nothing

`tests/unit/dispatch-base.test.mjs` — 8 tests, real git throughout.

```
$ node --test task-management/tests/unit/dispatch-base.test.mjs
# tests 8
# pass 8
# fail 0
```

The dispatch test carries its own control: it first asserts the stray commit **is** an ancestor of
the main checkout's HEAD, so "the worker branch contains none of it" cannot pass over an empty
fixture. With `resolveBase` stubbed back to its pre-fix behaviour (`return {ref:"HEAD",…}`):

```
    not ok 1 - prefers the repo's default branch over the parked HEAD
    not ok 2 - takes dispatch.base from config ahead of the default branch
    not ok 3 - takes an explicit ref ahead of everything, and does not second-guess it
    not ok 1 - cuts the worker branch from the default branch, carrying none of the parked work
    not ok 2 - honours dispatch.base when a repo wants its workers somewhere else
    not ok 1 - names it in the handoff and in the PR the handoff tells the worker to open
    not ok 2 - leaves a resumed branch's recorded base alone rather than restating its own tip
# pass 1
# fail 7
```

The stub was reverted and the suite re-run green before anything else was measured.

## 3. Full unit suite, both trees, same command, session env cleared

`TM_DISPATCH_BRANCH` / `TM_SESSION_ID` / `TM_ACTOR` / `TM_ROOT` leak from the dispatched session that
ran this and make 11 handoff/claim tests read the live session; they are unset for the measurement.

```
env -u TM_DISPATCH_BRANCH -u TM_SESSION_ID -u TM_ACTOR -u TM_ROOT -u TM_DISPATCH_TASK \
    -u TM_DISPATCH_WORKER node --test --test-concurrency=1 task-management/tests/unit/*.test.mjs
```

| tree | tests | pass | fail | failing names |
|---|---|---|---|---|
| `origin/main` `f89635a`, clean | 1487 | 1486 | 1 | `a supplied registry participates in selection` / `keeps an overridden name in its configured place` |
| with this change (`d306df2`) | 1495 | 1494 | 1 | *identical* |

The one pre-existing failure is the `TM_DISPATCH_REGISTRY` selection bug already written up in
`.claude/rules/verification-that-can-fail.md` §4. This change adds no failure and fixes none of it.

## 4. Bash suites that exercise the same paths

```
$ bash task-management/tests/test-worktree.sh    → 22 passed, 0 failed
$ bash task-management/tests/test-mcp.sh         → 77 passed, 0 failed
$ bash task-management/tests/test-dashboard.sh   → 210 passed, 0 failed
```

## What was verified vs. only read

**Verified** by running: base resolution against the real parked checkout; the worker branch
excluding the parked commits; `dispatch.base` precedence; the recorded ref+sha on both the task and
the `dispatched` record; the handoff header and PR body text; reuse leaving a recorded base alone;
the two suite totals above.

**Read, not verified:** that a live pool dispatch now produces a clean PR diff — no pool run was
started for this. The unit path exercised is the same `dispatch()` the pool calls, with a fake
backend in place of a real worker.

**Known limit, deliberately not fixed here:** `resolveBase` reads `origin/main` as it stands in the
local repo. Nothing fetches first, so a worker cut from a stale `origin/main` is stale by exactly as
much as the last fetch — which is also what its PR will be merged against. A fetch inside dispatch
is a network call on every provision and belongs to its own decision.
