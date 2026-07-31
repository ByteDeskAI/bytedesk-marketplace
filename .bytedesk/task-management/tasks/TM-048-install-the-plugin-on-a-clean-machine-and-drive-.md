---
id: "TM-048"
kind: "task"
status: "blocked"
created: "2026-07-31T07:35:31.336Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Install the plugin on a clean machine and drive it, once, as a stranger"
epic: "EP-005"
acceptance: [{"text":"The plugin is installed from the marketplace into a clean HOME, not symlinked from this checkout","done":false},{"text":"A board is created, a task moves, and the dashboard serves — with nothing this machine already had","done":false},{"text":"Every step that needed a fix is written down, in order, as the install path","done":false}]
evidence: []
commits: []
blockedBy: ["TM-046"]
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T07:35:56.903Z"
---

## Problem
Nothing has ever been installed from scratch. Every check this plugin has passed ran against this
working copy, with `~/.claude` already populated, `~/.local/bin` already on PATH, node already
present, and a store that has existed for days.

That is how TM-046 happened: a documented command that does not exist, shipped as supported, with a
full test suite green over it.

## Proposal
Install it the way a stranger would — a temporary HOME, the marketplace entry, no symlinks back
into this checkout — and drive the smallest useful path: init a board, create a task, move it, open
the dashboard. Fix whatever breaks, and write the order down. The output of this task is a install
path somebody else can follow, not a green suite.
