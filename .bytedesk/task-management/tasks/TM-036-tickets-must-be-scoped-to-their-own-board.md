---
id: "TM-036"
kind: "task"
status: "done"
created: "2026-07-30T21:06:09.203Z"
title: "Tickets must be scoped to their own board"
epic: "EP-003"
acceptance: [{"text":"Every entity records the board it belongs to, and a write to a store it does not belong to fails","done":true,"at":"2026-07-31T03:48:44.007Z"},{"text":"A dashboard only ever renders entities belonging to its own board","done":true,"at":"2026-07-31T03:49:53.275Z"},{"text":"Cross-repo references are expressible as links that name the other repo","done":true,"at":"2026-07-31T03:48:44.069Z"},{"text":"The existing leak is cleaned up: persona TM-001 no longer carries marketplace PR URLs","done":true,"at":"2026-07-31T03:48:44.135Z"},{"text":"A test reproduces the leak on the old code and passes on the new","done":true,"at":"2026-07-31T03:48:44.196Z"}]
evidence: [".bytedesk/task-management/evidence/TM-036-paths.mjs",".bytedesk/task-management/evidence/TM-036-board-scope.test.mjs"]
commits: ["pr","a7a2618"]
blockedBy: []
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T04:22:52.689Z"
comments: [{"author":"main","ts":"2026-07-31T03:50:25.003Z","text":"Root cause: linkGit reads the ref from the checkout the command ran in (CHECKOUT) but writes it to the store tm resolved (P). When CLAUDE_PROJECT_DIR and the shell's cwd are different repos, one project's PR lands on another project's task. Reproduced deliberately with two temp repos: on the old code, acme/other-repo's PR attached to acme/store-repo's task; with the guard it does not, and logs git_link_skipped. Persona TM-001 cleaned: 23 marketplace pull/new URLs removed, 3 legitimate refs kept. Note the identity lives in config.boardId, not config.board — the latter is already the dashboard's board preferences object, a collision the dashboard suite caught."}]
closed: "2026-07-31T03:50:43.350Z"
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
