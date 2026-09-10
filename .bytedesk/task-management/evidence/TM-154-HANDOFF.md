# TM-154 — the commit message, not the command string

**Merge:** head of `tm/TM-154-git-link-message`, off `main@1910b95`. Code commit `d60606b`.

## What it does

`linkGit` picked its target from the Bash COMMAND STRING, so `git commit -F <file>` and heredocs
attached nothing however clearly the subject named the task. It now also reads
`git log -1 --format=%B` — safe here, because the hook fires after the commit returns and already
asks git for the ref at that point.

**Only the subject line and explicit trailers** (`Refs:`, `Closes:`, `Fixes:`, `Task:`). Never the
whole body. Bodies in this repo routinely reason about other tasks in prose — "the same shape as
TM-135's defence 2" — and attaching a ref to every id someone mentioned would recreate TM-146's
over-attachment by a different route. The subject says what a commit IS; a trailer says what it is
filed against; a mention in the prose is neither.

TM-146's rule is intact: a message naming a task is an EXPLICIT statement about what changed, which
is what TM-146 required. A claim is not. This is a second explicit signal, not a restored guess.

## VERIFIED

**The tests are non-vacuous.** Applying only the new `tests/test-hooks2.sh` over an unmodified
`git archive` of `main`:

```
FAIL a -F commit whose SUBJECT names the task attaches
FAIL a Refs: trailer attaches
35 passed, 2 failed
```

With the fix: **37 passed, 0 failed**. The third and fourth assertions — that a task merely
*discussed* in the body attaches nothing, and that the refusal is recorded as
`git_link_unattributed` — pass on both sides, which is correct: `main` attaches nothing there either,
for the wrong reason.

**Gates**, all in this worktree:

| Gate | Result |
|---|---|
| `task-management` unit | 1364 tests, 1364 pass, 0 fail |
| capability / concurrency / dashboard / events | 22 / 12 / 210 / 12, 0 fail |
| **hooks2** | **37 pass, 0 fail** (was 33 + the 4 new) |
| hooks / install / link / mcp | 65 / 13 / 13 / 77, 0 fail |
| read / store / worktree | 59 / 134 / 22, 0 fail |
| `test-pool.sh` | **17 pass, 2 fail — TM-153, not this branch** |

`test-pool.sh` fails identically in the canonical checkout and in worktrees carrying none of these
changes, and passes only in a detached copy. Filed as TM-153; measured four ways there.

## A check that only works after you merge

This commit was written with `-F` deliberately. It did **not** attach — correctly, because the hook
that ran is `main`'s unfixed copy. Once this is merged, a commit of the same shape will attach, which
is the cleanest available proof and the same way TM-146 proved itself.

## READ ONLY, not executed

- `gh pr create` against real GitHub. The PR path is deliberately **excluded** from the message read
  — a PR's body is in the command or the response, not in `git log` — and its existing behaviour is
  unchanged. Exercised through the hook with a synthetic `tool_response`, as the TM-036 and TM-063
  tests already do.
