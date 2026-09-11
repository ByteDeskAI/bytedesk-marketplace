# TM-170 — the third instance of one guard, in one file

## Verified (ran it)

| gate | result |
|---|---|
| `test-store.sh` against `origin/main`'s `tm` | **FAIL** — "task new refuses an unknown option" (146 passed, 2 failed) |
| `test-store.sh` with the guard | ok, both new assertions (147 passed, 0 failed) |
| hooks / hooks2 / read / mcp | 65 / 40 / 59 / 77, all 0 failed |
| `node --test tests/unit/*.test.mjs` | 1374 pass, 0 fail |

The first row is the one that matters: the test was seen to fail against the defect
before it was trusted against the fix.

## The defect

`tm task new` splices out `--template`, `--body` and `--ac`, then takes the title as
`rest.join(" ")`. Any other flag survives into the title, and the create reports success.

Found by the tool doing it to me: filing TM-169 with `--epic EP-018` — a flag this verb
does not accept, since the epic comes from the active epic — produced a task literally
named `… but Claude asks anyway --epic EP-018`.

## Why it is the interesting kind of bug

`tm epic new` grew this guard after EP-017 was created with `--body` baked into its name.
`tm edit` grew it after `--title` was written literally into a title. `task new` — the
verb used most often — never got it. Three siblings, one shape, fixed one at a time as
each bit someone. All three now share the same two lines.

## A side effect I caused, and how it was caught

Placed inline beside the refusal assertion, the legitimate-create assertion turned
`board counts completion` red — creating a task mid-file shifts the counts a later
assertion checks. Moved to the end of the file. The refusal assertion stays inline
because a refused create writes nothing, which is exactly the property under test.

## What I got wrong

TM-170 exists because I created it by accident while testing this fix. I set `TM_HOME` to
a temp directory expecting isolation. The store does not read `TM_HOME` — it walks up from
the cwd, and the worktree is inside the repo — so the "isolated" create landed on the real
board as *"a legitimate title"*, carrying a stray criterion `x`.

Rule 2: name what your isolation removed before trusting it. I assumed an env var did
something without checking that anything reads it. Repurposed into this task rather than
left as litter; the stray criterion removed with `tm ac --rm 1`.
