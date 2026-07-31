---
id: "TM-041"
kind: "task"
status: "done"
created: "2026-07-31T03:49:57.277Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Board identity should come from git, and be read-only when it does"
epic: "EP-003"
acceptance: [{"text":"Board identity is read from git for the current directory, not from anything a person types","done":true,"at":"2026-07-31T04:22:23.370Z"},{"text":"When git supplies it, the value is read-only: tm and the dashboard both refuse to change it","done":true,"at":"2026-07-31T04:22:23.434Z"},{"text":"When git supplies nothing, the current fallback stands and is clearly marked as a guess","done":true,"at":"2026-07-31T04:22:23.508Z"},{"text":"A store whose git-derived identity later changes says so rather than silently re-labelling itself","done":true,"at":"2026-07-31T04:22:23.574Z"}]
evidence: [".bytedesk/task-management/evidence/TM-041-store.mjs"]
commits: ["a7a2618"]
blockedBy: []
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T04:22:52.680Z"
comments: [{"author":"main","ts":"2026-07-31T04:22:23.716Z","text":"Identity is now derived on every read: gitBoardId() from the origin remote wins, config.boardId is only a record, and boardIdentity() names its source — git (derived), config (recorded, no remote), or directory (a guess, and labelled as one). tm config boardId refuses with exit 2 when git answers, and the dashboard's settings allowlist already kept it out of reach — now asserted rather than assumed. Drift is reported as board-renamed instead of silently re-labelling. One defect found by the hooks suite while building this: making git authoritative meant a repo that gains a remote re-labels its board, and the TM-036 write guard then rejected every entity created before it — a rename would have bricked the store. Both the current and the recorded name now count as this board's own. Note on scope: you asked for 'the git user for the current directory'. I kept the identity as the REPO rather than the person, because two of your repos share one git user and collapsing them would undo TM-036 and fail its tests."}]
closed: "2026-07-31T04:22:52.479Z"
---

## Problem
TM-036 introduced `boardId`, derived from the origin remote with the directory name as a fallback,
and wrote it into `config.json` at init. Two things are wrong with that. The value is written into
a file anyone can edit, so the identity that gates cross-board writes is itself editable by the
thing it is meant to constrain. And the directory-name fallback is a guess presented as a fact.

## Proposal
Read identity from git for the current directory, every time, rather than trusting a stored copy.
When git answers, that answer is authoritative and the stored value becomes a cache the user
cannot override — `tm` and the dashboard both refuse to change it, and doctor reports a stored
value that disagrees with git.

When git has nothing to say — a project with no remote, or no repository at all — the present
fallback stands, but it should be recorded as a fallback so a later reader can tell a derived
identity from an assumed one.

Open question worth deciding while implementing: which git fact is the identity. The origin remote
is what TM-036 uses and survives a clone; `user.name`/`user.email` identify the *person*, not the
project, and two projects by the same person would collide. If the intent is the committing
identity rather than the repo, the field is a different one and should be named for what it is.
