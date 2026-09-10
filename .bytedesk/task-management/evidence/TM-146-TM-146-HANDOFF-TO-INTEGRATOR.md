# TM-146 — exact revision for the integrator

**Merge this:** the head of branch `tm/TM-146-git-link-claim-fallback`, based on `main@fb1558c`.
Named by branch because this file's own commit moves the head.

## What changed

`linkGit` in `task-management/bin/tm` no longer falls back to the active claim. Only two signals
attach a ref: a `TM-nnn` in the command, or a `tm/<ID>-` branch — the sibling path that already
behaved this way. A command naming neither attaches nothing and records `git_link_unattributed`.

**Both paths, deliberately.** The fallback is one shared expression, so it governed `gh pr create`
as well as `git commit`, and the argument does not weaken for pull requests: a PR opened while a
claim is held is no more evidence about that task's content than a commit is. TM-146's criteria name
commits; the widening is stated in the code, in the commit message and here so it reads as a
decision. TM-144 already fixed how the PR *ref* is derived, and left *target* selection untouched,
so the two fixes compose — that path currently has a correct ref pointed at a possibly-wrong task.

**One reorder, forced by a real regression.** The cross-repo guard now runs before attribution.
Without it my change broke the existing TM-036 test: a wrong-repo PR that named no task returned
early as "nothing to attach" and never logged `git_link_skipped`. Whether a ref belongs to this
board is a fact about the ref; which task it names is a separate question. This order keeps each
refusal meaning what it says.

**A second file, which the test found and I would not have.** `lib/ntfy.mjs` carries a catalog that
must list every event kind the store emits, and `ntfy.test.mjs` fails on any event that is missing
from it. Adding an event to `bin/tm` is therefore a two-file change in this store.
`git_link_unattributed` is registered beside `git_link_skipped`, at `min` priority because it is the
ordinary case: most commits in a repository are not a task's evidence.

## VERIFIED

**The test is non-vacuous.** Applying only the new `tests/test-hooks2.sh` over an unmodified
`git archive` of `main` — nothing else of mine in that tree — fails 2:

```
FAIL a commit naming no task, on a branch naming no task, attaches nothing to the CLAIMED task
FAIL the unattributed commit is on the record, not silent
31 passed, 2 failed
```

With the fix: **33 passed, 0 failed**.

**Gates**, all in this worktree:

| Gate | Result |
|---|---|
| `task-management` unit (1364 files' worth) | 1364 tests, 1364 pass, 0 fail, 0 skipped |
| `test-capability.sh` | 22 pass, 0 fail |
| `test-concurrency.sh` | 12 pass, 0 fail |
| `test-dashboard.sh` | 210 pass, 0 fail |
| `test-events.sh` | 12 pass, 0 fail |
| `test-hooks2.sh` | 33 pass, 0 fail (was 31 + the 2 new) |
| `test-hooks.sh` | 65 pass, 0 fail |
| `test-install.sh` | 13 pass, 0 fail |
| `test-link.sh` | 13 pass, 0 fail |
| `test-mcp.sh` | 77 pass, 0 fail |
| `test-read.sh` | 59 pass, 0 fail |
| `test-pool.sh` | **17 pass, 2 fail — NOT mine, see below** |

## `test-pool.sh` — not mine, and worth its own task (TM-153)

It fails **in the canonical checkout too**, and in a worktree that has none of my changes. Measured
four ways:

| Where | Result |
|---|---|
| canonical checkout `bytedesk-marketplace/task-management` | 17 pass, **2 fail** |
| `.bytedesk/worktrees/TM-143-refusal` (no TM-146 changes) | 17 pass, **2 fail** |
| `git archive` of `main`, detached copy | 19 pass, 0 fail |
| `tar` of this working tree, detached copy | 19 pass, 0 fail |

So it is neither a revision difference nor this branch's: it is TM-152's shape again, a test whose
verdict depends on where it runs. The tick's own JSON gives the lead:
`"reason": "ao-topology launch exited 1: "` — an exit code with **empty stderr**. In a detached copy
the backend probe finds nothing and the test takes a passing path; in a real checkout it finds the
real binary and the call fails silently. Filed as **TM-153** with both defects named: the swallowed
stderr first, because it is what makes the second one hard to see.

## READ ONLY, not executed

- The `gh pr create` path against a real GitHub call. The PR cases are exercised through the hook
  with a synthetic `tool_response`, exactly as the existing TM-036 and TM-063 tests do.
- The ntfy sender itself. The catalog is asserted by `ntfy.test.mjs`; no notification was published.
