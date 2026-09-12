---
id: "TM-190"
kind: "task"
status: "open"
created: "2026-09-12T03:03:04.475Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: touches records worktree-prefixed paths because CHECKOUT resolves to the main checkout, not the worktree"
acceptance: [{"text":"An Edit inside a .claude/worktrees native worktree records a checkout-relative path with no .claude/worktrees/<agent>/ prefix","done":false},{"text":"currentCheckout resolves to the checkout the edit happened in; CLAUDE_PROJECT_DIR no longer overrides it when the two differ","done":false},{"text":"Regression test pins both worktree layouts: .claude/worktrees/<agent>/ and .bytedesk/worktrees/<TM-id>/","done":false},{"text":"A supported way exists to correct already-poisoned touches, since record() is append-only with no removal verb","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "58d7cd20-54ac-45c8-84a6-ea82dbebfad2"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["plugin:task-management","ready-for-agent"]
triagedBy: "human"
updated: "2026-09-12T03:12:35.000Z"
---

## Symptom

Tasks worked in an isolated worktree record `touches` entries prefixed with the worktree
path instead of checkout-relative paths, e.g. on gateway TM-309:

    .claude/worktrees/agent-af1e20c5e20e16e19/web/src/organisms/orchestration/RunDetail.tsx

`tm parallel` batches on `touches`, so the real file (`web/src/.../RunDetail.tsx`) is not
declared by any task. Two tasks editing the same file look disjoint and get wrongly
parallelised — the exact failure the feature exists to prevent.

Not a one-off: at least 10 tasks in ByteDeskAI/bytedesk-remote-gateway carry this shape
(TM-309, TM-275, TM-281, TM-291, TM-031, TM-056, TM-057, TM-059, TM-061, TM-068, TM-069).

## Root cause (verified, not inferred)

`lib/touches.mjs` is correct and its intent is explicit: `observe()` passes `base: CHECKOUT`
so "a worktree's src/auth.ts is expressed relative to its own checkout".

The defect is in `lib/paths.mjs:50`:

    export function currentCheckout(cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
      return git(cwd, ["rev-parse", "--show-toplevel"]) || real(cwd);
    }

`CLAUDE_PROJECT_DIR` is the ORIGINAL project directory, so inside a Claude Code native
worktree it points at the main checkout. `rev-parse --show-toplevel` is then run from
there and returns the main checkout, defeating `base`.

Reproduced on this machine:

    git -C <main>/.claude/worktrees/agent-a4ca3648c36556e73 rev-parse --show-toplevel
      -> <main>/.claude/worktrees/agent-a4ca3648c36556e73     (what "standing in" should mean)
    git -C <main> rev-parse --show-toplevel
      -> <main>                                               (what currentCheckout does)

    relpath(<wt>/web/src/organisms/orchestration/RunDetail.tsx, <wt>)
      -> web/src/organisms/orchestration/RunDetail.tsx
    relpath(same file, <main>)
      -> .claude/worktrees/agent-a4ca3648c36556e73/web/src/organisms/orchestration/RunDetail.tsx

The second reproduces the stored bad value exactly.

## Why the two worktree layouts fail differently

`IGNORED` in touches.mjs drops `.bytedesk/`, `.git/` and `node_modules/`, but NOT `.claude/`.

- `.bytedesk/worktrees/<TM-id>/...` -> matches IGNORED -> `normalise` returns null ->
  the observation is silently DROPPED (data lost, scope left empty).
- `.claude/worktrees/<agent>/...`   -> not ignored -> recorded verbatim (scope POISONED).

Both are wrong; only the second is visible in the task file. A fix that only extends
IGNORED would convert poisoning into silent loss, not correctness — `base` has to resolve
to the real checkout.

## Note for the fix

`record()` is append-only (read-append-write inside the lock) and the `tm touches` verb has
no removal or replace flag, so existing poisoned entries cannot be corrected through the
store. Appending the correct paths restores `tm parallel` behaviour but leaves the stale
entries behind; that was done on gateway TM-309 as a stopgap.
