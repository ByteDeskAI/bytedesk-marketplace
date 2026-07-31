---
id: "TM-043"
kind: "task"
status: "done"
created: "2026-07-31T05:23:36.378Z"
board: "bytedeskai/bytedesk-marketplace"
title: "The store's git contract does not ignore its own lock files"
epic: "EP-004"
acceptance: [{"text":"state.lock and state.lock.break are ignored by the contract tm init writes","done":true,"at":"2026-07-31T05:28:11.896Z"},{"text":"tm doctor tops up an existing store, which the 0.6.1 stale-contract check already knows how to do","done":true,"at":"2026-07-31T05:28:11.979Z"},{"text":"A committed lock from before this cannot block a fresh clone","done":true,"at":"2026-07-31T05:28:12.055Z"}]
evidence: [".bytedesk/task-management/evidence/TM-043-store.mjs"]
commits: ["6c9e01a"]
blockedBy: []
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T05:28:21.853Z"
comments: [{"author":"main","ts":"2026-07-31T05:28:12.212Z","text":"Template gains state.lock and state.lock.break. Existing stores are reached by the 0.6.1 stale-contract check with no new mechanism: doctor reports '.gitignore predates 2 rule(s) this version ships: state.lock, state.lock.break' and --fix appends them, preserving hand-added rules. Applied to this repo's own store the same way a user would. Third criterion verified end to end rather than reasoned about: built a store with a lock committed the way an older tm would, cloned it, and wrote to the clone — staleLock reads a pid from another machine as dead, so the clone is never blocked. That is why this was noise rather than deadlock, and still worth closing."}]
closed: "2026-07-31T05:28:21.850Z"
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
