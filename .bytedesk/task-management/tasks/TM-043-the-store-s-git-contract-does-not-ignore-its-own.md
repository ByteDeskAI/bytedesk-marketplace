---
id: "TM-043"
kind: "task"
status: "open"
created: "2026-07-31T05:23:36.378Z"
board: "bytedeskai/bytedesk-marketplace"
title: "The store's git contract does not ignore its own lock files"
epic: "EP-004"
acceptance: [{"text":"state.lock and state.lock.break are ignored by the contract tm init writes","done":false},{"text":"tm doctor tops up an existing store, which the 0.6.1 stale-contract check already knows how to do","done":false},{"text":"A committed lock from before this cannot block a fresh clone","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T05:24:04.684Z"
---

## Problem
`git check-ignore` says `state.lock` is not ignored, and `git status` lists it. The store's
contract ignores `index.json`, `state.json`, `dashboard.*`, `port.assigned` and `.tm-tmp-*` — every
per-machine file except the two the lock itself creates.

A process killed mid-write leaves `state.lock` behind. One `git add -A` later it is committed, and
every clone gets a lock file belonging to a pid that never existed on that machine. `staleLock`
will break it — a dead pid reads as stale — so the damage is noise rather than deadlock, but it is
noise in the one file that exists to make concurrent writes safe.

## Proposal
Add `state.lock*` to the contract template. The mechanism to reach existing stores already exists:
0.6.1 made `tm doctor` compare a store's contract against the template and top up what is missing,
which is exactly this case — so this is a template line plus a test.
