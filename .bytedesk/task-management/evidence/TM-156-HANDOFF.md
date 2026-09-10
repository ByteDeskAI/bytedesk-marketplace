# TM-156 — `--title` is a flag, and an unknown flag is an error

**Merge:** head of `tm/TM-156-title-flag`. Stacked on `tm/TM-154-git-link-message` because both
touch `bin/tm`; take TM-154 first. Code commit `ed3fc5d`.

## The cause, which is one line and not what either of us guessed

`edit(id, ...rest)` takes the title **positionally**. So `tm edit <id> --title "X"` puts the literal
string `--title` in `rest[0]`, sets the title to it, and throws X away.

It then prints `title updated (was "<old title>")`. That names the **old** title, so it reads exactly
like success — which is why two agents in one session believed the verb worked. TM-155 sat on the
board reading `--title` until its frontmatter was repaired by hand.

**`tm block` is innocent, and I am recording that because I inferred otherwise and passed it on as
fact.** It writes `status` and `blockedReason` only. I saw a corrupted title after running `block`
and attributed it to the last command I ran rather than the last command that could have caused it;
the corruption was always from an `edit --title` call minutes earlier. That inference sent the
integrator looking for shared argument parsing that does not exist.

## The fix

- `--title <value>` accepted alongside the positional form.
- `--title` with no value is refused rather than consuming the next flag.
- **An unrecognised `--flag` fails loudly instead of being written into a field.**

That last one is the half that matters, and it is not new code — `epic new` already carries exactly
this guard. Its comment says it was added after EP-017 was created with `--body` baked into its
name. The same defect, one verb over, and the fix never propagated. **A guard present in one verb
and absent in its sibling is worse than no guard**: the CLI behaves inconsistently, and the
inconsistent half looks like it worked.

## VERIFIED

Six new assertions in `test-store.sh`. Against unmodified `main`, with only the test file swapped in,
**all six fail**:

```
FAIL --title <value> retitles
FAIL the flag NAME is never written into the title
FAIL the positional form still works
FAIL an unknown option is refused
FAIL --title with no value is refused
FAIL and a refused edit changes nothing
134 passed, 6 failed
```

("the positional form still works" fails on `main` only because its predecessor left the title as
`--title`, so the assertion about what it *was* does not hold. It is a regression guard, and it
belongs in the set.)

| Gate | Result |
|---|---|
| `task-management` unit | 1364 tests, 1364 pass, 0 fail |
| **store** | **140 pass, 0 fail** (was 134 + the 6 new) |
| capability / concurrency / dashboard / events | 22 / 12 / 210 / 12, 0 fail |
| hooks2 / hooks / install / link | 37 / 65 / 13 / 13, 0 fail |
| mcp / read / worktree | 77 / 59 / 22, 0 fail |
| `test-pool.sh` | **17 pass, 2 fail — TM-153, not this branch** |

`test-pool.sh` fails identically in the canonical checkout and in worktrees carrying none of these
changes; measured four ways on TM-153.

## READ ONLY, not executed

- The MCP `tm_task_edit` tool path. This fixes the CLI verb; whether the MCP surface reaches the
  same code with the same argument shape was not checked, and if it takes a structured `{title}` it
  was never affected.
