---
id: "TM-041"
kind: "task"
status: "open"
created: "2026-07-31T03:49:57.277Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Board identity should come from git, and be read-only when it does"
epic: "EP-003"
acceptance: [{"text":"Board identity is read from git for the current directory, not from anything a person types","done":false},{"text":"When git supplies it, the value is read-only: tm and the dashboard both refuse to change it","done":false},{"text":"When git supplies nothing, the current fallback stands and is clearly marked as a guess","done":false},{"text":"A store whose git-derived identity later changes says so rather than silently re-labelling itself","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T03:50:16.406Z"
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
