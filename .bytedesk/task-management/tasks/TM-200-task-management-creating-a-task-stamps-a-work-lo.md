---
id: "TM-200"
kind: "task"
status: "open"
created: "2026-09-13T21:00:52.213Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: creating a task stamps a work location, so it inherits whatever branch the shared checkout was on"
epic: "EP-021"
acceptance: [{"text":"A task created from a checkout sitting on an unrelated branch carries no branch/worktree until it is started or dispatched","done":false},{"text":"The duplicate scan and collect's PR lookup never consult a location the task has not actually worked on","done":false},{"text":"The already-stamped open tasks TM-194..TM-198 are corrected or deliberately left, and the decision is recorded","done":true,"at":"2026-09-13T22:08:38.235Z"},{"text":"A regression test covers creation-time stamping, so this cannot silently return","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "d317b837-ffd4-495a-a690-4168952e4fec"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-13T22:08:38.240Z"
type: "bug"
touches: ["task-management/bin/tm","task-management/lib/actor.mjs","task-management/lib/dispatch/collect.mjs","task-management/lib/dispatch/duplicate.mjs"]
comments: [{"author":"main","ts":"2026-09-13T22:08:38.090Z","text":"AC 3 done 2026-09-13: TM-194, TM-195, TM-196 and TM-197 had their creation-time branch/worktree cleared by hand. All four were status open, never started, and carried no commit mentioning them on the stamped branch (fix/reviewer-collect-reassembles-wrapped-json and feat/dispatch-duplicate-guard respectively), so nothing was a real work location. TM-198 needed no fix: it was dispatched after the survey and now carries its own genuine tm/TM-198-... branch in its own worktree, which shows dispatch overwrites the bogus stamp. The 35 closed tasks are left as history. So the harm window is creation until first dispatch - which is exactly when the duplicate guard scans and when a person reads the board."}]
---

`tm task new` records where the *creating process was standing* as though it were
where the task's work lives. When the shared checkout happens to be on another
session's feature branch — increasingly normal with many concurrent sessions —
the new task inherits that branch and never had anything to do with it.

## Mechanism

`bin/tm:189` binds `const stamp = () => stampAt(CHECKOUT)`, and `task new`
(`bin/tm:353`) spreads `...stamp()` straight into the new record. `lib/actor.mjs`
is explicit that these are provenance fields — *"who, which session, which
branch, which checkout"* — but `branch` and `worktree` are also read elsewhere as
the task's work location. Those two meanings agree for every write except the
first, where the task has no location at all and the stamp invents one.

Every creation path is affected, not just `task new`: `epic new` (`:290`), goal
import (`:398`), manifest import (`:1771`) and captured plans (`:2231`).

## Why it does not wash out

`tm start` deliberately *preserves* a recorded location that disagrees with the
current checkout (TM-148, `bin/tm:508-533`) and prints "keeps its recorded
location", requiring `--here` to override. That logic is right for work that
genuinely moved, but it makes a bogus creation-time stamp authoritative for the
life of the task.

## What reads it

- `lib/dispatch/collect.mjs:60` runs `gh pr list --head <task.branch>` and
  attaches the result as the task's PR — so a task can adopt an unrelated
  branch's pull request.
- `lib/dispatch/duplicate.mjs:89` excludes the task's own branch from the
  duplicate-work scan (`--not refs/heads/<branch>`), suppressing exactly the
  commits the guard exists to surface. Its comment states the correct state
  plainly: *"A task dispatched for the first time has no branch yet, and then
  every match is somebody else's."*

## Blast radius, as of 2026-09-13

Five open tasks carry a foreign branch from creation and have never been worked
on it:

    TM-194, TM-195   fix/reviewer-collect-reassembles-wrapped-json
    TM-196, TM-197, TM-198   feat/dispatch-duplicate-guard

35 closed tasks are stamped the same way; those are history and probably best
left alone. TM-199 had it too and was hand-cleared, which is how this was found.

**This task is its own reproduction.** It was created while the shared checkout
sat on `feat/dispatch-duplicate-guard`, was stamped with that branch, and had to
have the field cleared by hand — the same remedy the TM-148 comment records for
TM-135 and TM-143. A store that needs hand-editing to undo its own automatic
write is the thing to fix.
