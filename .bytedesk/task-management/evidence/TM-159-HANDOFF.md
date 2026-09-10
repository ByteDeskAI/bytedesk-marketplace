# TM-159 — a commit takes its ids from the message alone

**Merge:** head of `tm/TM-159-command-string`, off `main@d386660`. Code commit `e160820`.

## What was wrong with my own TM-154

TM-154 made the commit message readable and then took the **union** of message and command string.
That left the looser source in charge, because of how these commits are actually written: the
message is a heredoc **in the same Bash invocation**, so the entire body — every task discussed in
prose — sits in the command string, and the subject-only reading never gets consulted.

The integrator observed it in production immediately: `578498b`, the merge commit for TM-154 itself,
attached to **nine** tasks; `b0732c9` to three. Both corrected by hand.

## The fix

```js
const mentioned = isPRCommand ? (cmd.match(/\bTM-\d+\b/g) || []) : idsFromCommitMessage();
```

For a `git commit`, the command string is not read at all. **Nothing is lost:**
`git commit -m "TM-nnn: …"` puts the id in the message too, so `git log -1` still sees it, and a
`-F` or heredoc message was never in the command anyway. What goes is the only route by which a task
merely *mentioned* in a body could attach.

`gh pr create` keeps reading its command, because it has no committed message to read instead.

## VERIFIED

**The control is the sharp one.** The new heredoc assertion, applied over `main` **which already has
TM-154 merged**, fails:

```
FAIL a task discussed in the body does NOT attach, even though the heredoc put it in the command string
39 passed, 1 failed
```

So the test reproduces the nine-task attach rather than describing it. With the fix: **40 passed, 0
failed**.

| Gate | Result |
|---|---|
| `task-management` unit | 1366 tests, 1366 pass, 0 fail |
| **hooks2** — the suite this changes | **40 pass, 0 fail** |
| capability / concurrency / dashboard / events | 22 / 12 / 210 / 12, 0 fail |
| hooks / install / link | 65 / 13 / 13, 0 fail |
| mcp / read / store / worktree | ran after this file was written; see the task's block note |
| `test-pool.sh` | expected 17/2 — TM-153, unrelated |

**This commit is its own test case.** `e160820`'s subject names TM-159 and its body names TM-154.
Under `main` today it would attach to both; under this fix, only to TM-159. Checkable directly after
the merge, the way TM-146 proved itself.

## One pre-existing assertion had to be corrected, and it is the finding

TM-146's *"a commit that NAMES its task still attaches"* drove the hook with `-m "…TM-002"`
**without ever making a commit carrying that message**. It passed only because the id was read out
of the command string. Under the new rule the fixture must create the commit it describes.

That is the same looseness that let a heredoc attach nine tasks — and it was sitting in our own test
suite, asserting the behaviour was correct. A test that simulates a command instead of performing it
will keep passing through exactly the change that breaks the thing it claims to protect.

## READ ONLY, not executed

- `gh pr create` against real GitHub. Its path is deliberately unchanged and is exercised through
  the hook with a synthetic `tool_response`, as the TM-036 and TM-063 tests do.
- `git commit --amend`. The message is still readable by `git log -1`, so it should behave
  identically, but no amend was driven through the hook.
