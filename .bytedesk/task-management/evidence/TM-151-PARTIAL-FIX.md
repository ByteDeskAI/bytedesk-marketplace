# TM-151 — a partial fix, and why the rest is a design decision

**Branch:** `tm/TM-151-ready-placeholder`, off `main@a31042c`. **This does not close the task.**
AC1 as written is not met, and the reason is evidence gathered after the fix was written.

## What the change does

All four `providers/claude.json` fields gain one alternation — the literal `Try "` branch — decided
per field rather than by find-and-replace, with the argument written into each `note`:

| field | why it changes |
|---|---|
| `ready.tmux_pattern`, `ready.pattern` | a fresh session's ready composer renders the placeholder hint, so the old pattern called a healthy pane not-ready |
| `composer.empty_tmux_pattern`, `composer.empty_pattern` | the hint renders **only** when the box is empty — it is placeholder text, which is exactly what this field asks — so without the branch a submitted message reads as `typed-unsubmitted` and rung R0 resubmits into a composer that already sent |

The TM-111 negatives are preserved: `❯ No, exit` and `❯ 1. Yes, and switch to BYPASS PERMISSIONS`
still answer 0, because the branch requires the literal `Try "`.

## Verified

Six tests in `tests/unit/topology-ready-placeholder.test.mjs`, holding the strings tmux actually
rendered. Against unmodified `main`, **4 of 6 fail**; with the change, 6 of 6 pass. They also assert
the tmux forms stay tmux-safe (no `{`, `}`, `:`, newline) and that the hint branch is *literal* —
`❯ Trying "…"` and `❯ Try fix lint errors` must not match, or the fix would readmit the mid-answer
case the original pattern existed to reject.

Live measurement, two reviewer panes during the demo: shipped **0**, fixed **12**.

**Gates**, in this worktree: topology unit **335 tests, 335 pass, 0 fail**; both frozen presence
validators pass unmodified; `roadmap:check` OK; operator tmux sessions 5 before and after.

The five `src/` suites — `mcp-contract`, `runtime-engine`, `service-routing`, `session-host`,
`session-supervisor` — **were not run here and are not reported as a result**. This worktree has no
`node_modules`, so they fail with `Cannot find package 'zod'`. They pass 41/41 in the canonical
checkout, which is where they should be gated. I deliberately did not symlink `node_modules` in to
make them run: that is precisely what produced TM-152's false failure, because a symlinked
dependency tree rewrites the paths esbuild embeds. The topology suite needs no dependencies at all,
which is ADR-0001's dependency-free rule paying off.

## Why it does not close the task

After both role agents bootstrapped and went idle, their composers read:

```
❯ init the task store
❯ Read /home/…/agents/b072692f/prompt.md and begin your standing role. Poll your protocol inbox…
```

Shipped pattern: **0**. This fix: **also 0**. So the `Try "` branch fixes the fresh-session hint and
nothing else. A ready pane can carry arbitrary text — a suggestion Claude generated from its own last
turn, or an unsent draft.

**Widening the pattern is not the answer**, and the negative that proves the fix is the same negative
that blocks the obvious extension: if trailing text were admitted, a composer holding a draft would
read as ready *and* as empty, and the delivery ladder would type a second copy on top of it. A
suggestion and a draft are identical in a capture, because the difference is styling.

So ready/composer-empty cannot be decided from the composer line alone for this provider. Three
candidates, none free, all on the task:

1. Read the **styled** cell — `capture-pane -e` keeps the escape sequences that carry the dim ghost
   rendering, which is the actual discriminator.
2. Use the **status line** instead — `⏵⏵ auto mode on … · N tokens` when idle, a spinner otherwise.
   The census already reads exactly this, and has been right all three times it disagreed with the
   readiness check.
3. Keep the pattern for the empty case and treat "not empty" as **unknown** rather than not-ready,
   so the launcher stops refusing on it.

## Take it anyway, or don't — but know which

Merging this is strictly better than shipping: it unblocks the *first* launch in any fresh session,
which is the case that blocks every new repository. It does not make a governed launch work, because
**TM-157** — the reviewer cannot acknowledge a nonce, having no shell under `--restricted --safe-mode`
— is the other half, and that one is a design decision about the launch gate rather than a pattern.
