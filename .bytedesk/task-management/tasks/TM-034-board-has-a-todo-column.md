---
id: "TM-034"
kind: "task"
status: "open"
created: "2026-07-30T21:01:29.600Z"
title: "Board has a todo column"
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
updated: "2026-07-30T21:01:39.621Z"
---

## Problem
The board has no todo column. Work that is decided but not started has nowhere to sit, so it
is indistinguishable from the rest of the open backlog.

## Proposal
A todo column between open and in progress. Open means "on the list"; todo means "agreed,
next up, nobody has started it".

## Acceptance criteria
- [ ] The board renders a todo column
- [ ] A task can be moved into and out of todo by drag and from the CLI
- [ ] The status survives a reload and appears in `tm board`
- [ ] Tasks that never enter todo keep their existing status unchanged
