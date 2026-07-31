---
id: "TM-036"
kind: "task"
status: "open"
created: "2026-07-30T21:06:09.203Z"
title: "Tickets must be scoped to their own board"
epic: "EP-003"
acceptance: []
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "55951e93-6838-4974-8033-11461bdd2dc4"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T01:49:44.318Z"
---

## Problem
Tickets from one repo appear on another repo's board. Reported against the marketplace board
showing persona tickets.

A related leak is evidenced and reproducible today: `bytedesk-persona`'s TM-001 — a closed
persona task — has 25 `bytedesk-marketplace` pull-request URLs in its `commits` array. Plugin
work done with the working directory set to the persona repo stamped persona tasks with
marketplace PRs. Same class of defect: a write found the wrong board.

## Current state
A board is whatever store `tm` resolves from the cwd, or from `TM_ROOT`. Nothing on the write
path checks that the entity being written belongs to the store being written to, and nothing on
the read path checks that what came back belongs to the board asking.

At the time of writing, `GET /api/board` on the marketplace dashboard returned 35 tasks, all of
them marketplace tasks — so the specific view the report describes was not reproduced from the
API. The scoping guarantee is still missing either way, and the TM-001 leak proves it.

## Proposal
Scope tickets to their board, and make a cross-board write fail loudly rather than land quietly.
Cross-board *interaction* is worth having — a persona task referencing a plugin PR is a real
relationship — but it belongs in a link with a named repo, not in an id that silently resolves
against whichever store the cwd happened to pick.

## Acceptance criteria
- [ ] Every entity records the board it belongs to, and a write to a store it does not belong to fails
- [ ] A dashboard only ever renders entities belonging to its own board
- [ ] Cross-repo references are expressible as links that name the other repo
- [ ] The existing leak is cleaned up: persona TM-001 no longer carries marketplace PR URLs
- [ ] A test reproduces the leak on the old code and passes on the new
