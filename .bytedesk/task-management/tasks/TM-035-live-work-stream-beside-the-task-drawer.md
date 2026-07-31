---
id: "TM-035"
kind: "task"
status: "open"
created: "2026-07-30T21:01:29.658Z"
title: "Live work stream beside the task drawer"
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
updated: "2026-07-30T21:01:39.690Z"
---

## Problem
Opening a task that is being worked on shows its fields and nothing about the work itself.
The area to the right of the drawer sits empty while a run is in flight.

## Proposal
A read-only stream of the work for an in-progress task, filling the space between the right
edge of the drawer and the right edge of the screen. Built with the TanStack AI components,
styled with ADS so it matches the rest of the board.

Read-only, for viewing. No input, and no control that mutates the run.

## Acceptance criteria
- [ ] Opening an in-progress task shows its work stream to the right of the drawer
- [ ] The panel fills the space between the drawer and the right edge of the viewport at any width
- [ ] The stream is read-only — it exposes no control that changes the run
- [ ] It uses the TanStack AI components and ADS tokens, consistent with the rest of the board
- [ ] A task that is not in progress does not render the panel
