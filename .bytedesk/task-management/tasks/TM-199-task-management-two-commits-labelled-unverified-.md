---
id: "TM-199"
kind: "task"
status: "open"
created: "2026-09-13T20:51:38.158Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: two commits labelled 'unverified' sit on published main, carried there by an unrelated PR"
epic: "EP-021"
acceptance: [{"text":"A decision is recorded on the two commits: either the stale 'unverified' subjects are reconciled on main in a forward-only way, or the task states plainly that they stay and why","done":false},{"text":"git log and git blame on main no longer imply unverified content where TM-178 and TM-180 were in fact accepted with evidence","done":false},{"text":"The delivery gap is closed or documented: a task branch's PR must not be able to publish unrelated unpushed main commits without that being visible to whoever merges","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/114"]
blockedBy: []
blocks: []
actor: "main"
session: "d317b837-ffd4-495a-a690-4168952e4fec"
labels: ["ready-for-human"]
triagedBy: "human"
updated: "2026-09-13T21:29:48.079Z"
type: "chore"
touches: ["task-management/lib/dispatch/collect.mjs"]
---

Two commits on published `main` end their subject with "unverified":

    225711a TM-178: WIP — ensure/detached pool redesign, unverified
    e6877ff TM-180: WIP — handoff, collect PR lookup and docs, unverified

**The work itself is fine.** TM-178 and TM-180 are both `done`, every acceptance
criterion ticked, each with VERIFY evidence attached
(`.bytedesk/task-management/evidence/TM-178-VERIFY.md`, `TM-180-VERIFY.md`). The
"unverified" label describes the moment of an intermediate commit, not what is on
main now. This is a history and auditability issue, not a code-quality one.

The part that actually bites: `task-management/lib/dispatch/collect.mjs` has not
been touched since `e6877ff`, so `git log` and `git blame` on main present that
file's current content under a commit that calls itself unverified. A reader of
the repository cannot tell the work was later accepted without going into the tm
store. `task-management/lib/dispatch/pool.mjs` is not affected — `40ca731`
(TM-179) superseded it.

## How they reached published main

Not by their own merge. On 2026-09-12 `origin/main` was 25 commits behind local
`main`, and the branch for an unrelated task — gateway TM-304, marketplace
PR #114 — had been cut from local `main`. Merging that PR therefore published all
25 commits, these two included. `git merge-base --is-ancestor e6877ff dee2637`
returns true.

The worker on TM-304 flagged this before the merge and asked for `main` to be
pushed first, which would have reduced the PR to its own single commit. The push
was refused by the dispatch guard (a worker may push only its own branch), the
merge went ahead, and the commits were published as a side effect.

So the durable defect is the delivery path, not these two commits: a PR opened by
a dispatch worker silently carries whatever unpushed work is sitting on local
main, and nothing surfaces that to the person clicking merge.

## Constraint on any fix

`main` is published and other clones exist. Rewriting history to drop or reword
these commits is not on the table; anything done here has to be forward-only —
a follow-up commit, a note, or an accepted "leave it" with the reason recorded.
