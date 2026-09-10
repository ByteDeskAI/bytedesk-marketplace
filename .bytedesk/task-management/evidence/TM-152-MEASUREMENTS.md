# TM-152 — the bundle recorded where it was built

**Branch:** `tm/TM-152-build-check-location`. **`dist/` is unchanged** — the fix reproduces the
already-committed bytes from either location, which is the strongest form this could have taken.

## The measurement, four builds

`claude-agent-acp.mjs` / `cli.cjs`, sha256, first 7:

| build | node_modules | before the fix | after |
|---|---|---|---|
| canonical checkout | real directory | `build:check` **exit 0** | exit 0 |
| linked worktree | symlink to the canonical one | `build:check` **exit 1**, "Tracked bundle is stale" | **exit 0** |
| linked worktree | symlink | `3a50e83` / `35d76ef` | `a0a6b3e` / `35d76ef` |
| linked worktree | **real** (hardlinked copy, so realpath stays in-tree) | `a0a6b3e` / `35d76ef` | `a0a6b3e` / `35d76ef` |

Before: the two locations produced different `claude-agent-acp.mjs`. After: identical, and equal to
the committed bundle. `cli.cjs` was already stable once `preserveSymlinks` was set — the ACP bundle
needed the second half of the fix.

A hardlinked copy is what makes the last row a real test rather than a re-run: it is a genuine
directory, so `realpath` resolves inside the tree exactly as it does in the canonical checkout,
without copying 805 MB.

## The two causes, and why one was not enough

1. **esbuild realpaths every module.** `preserveSymlinks: true` stops it; `absWorkingDir: root` pins
   what the remaining relative paths are relative to, so the answer no longer depends on the cwd the
   command was run from either.
2. **`require.resolve` always realpaths, and esbuild cannot reach it.** The ACP bundle names its
   entry point that way, so it came back as the symlink TARGET and kept that one bundle
   location-dependent after everything else was fixed. It is now mapped back onto the literal
   in-tree `node_modules`, so the entry point agrees with the rest of the graph.

## Why this was worth fixing rather than documenting

Every dispatched worker in this repository works in a linked worktree. So every worker saw
`build:check` fail and **could not tell that failure from a real one** — I reported it as a `main`
failure earlier today on exactly that evidence, and the integrator had reported it as passing after
reading only the tail of its output without the exit code. A gate that answers differently depending
on who runs it is worse than no gate: it teaches people to discount it.

## VERIFIED versus READ

- **Verified:** the four builds above, run in this session; `check-bundle.mjs` exit 0 in the
  symlinked worktree; `git status` showing `dist/` unchanged, so the committed bundles still match.
- **Read only:** the effect on `npm pack` / the published tarball. Nothing in the fix changes what
  is bundled — only the paths recorded in comments — but no packaging run was made to confirm it.
