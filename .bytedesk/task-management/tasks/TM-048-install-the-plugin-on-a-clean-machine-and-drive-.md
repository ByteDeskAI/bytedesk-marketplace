---
id: "TM-048"
kind: "task"
status: "done"
created: "2026-07-31T07:35:31.336Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Install the plugin on a clean machine and drive it, once, as a stranger"
epic: "EP-005"
acceptance: [{"text":"The plugin is installed from the marketplace into a clean HOME, not symlinked from this checkout","done":true,"at":"2026-07-31T09:02:49.374Z"},{"text":"A board is created, a task moves, and the dashboard serves — with nothing this machine already had","done":true,"at":"2026-07-31T09:02:49.446Z"},{"text":"Every step that needed a fix is written down, in order, as the install path","done":true,"at":"2026-07-31T09:02:49.511Z"}]
evidence: [".bytedesk/task-management/evidence/TM-048-test-install.sh"]
commits: ["475d4fc","700f4f1"]
blockedBy: ["TM-046"]
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T09:03:21.559Z"
comments: [{"author":"main","ts":"2026-07-31T09:02:49.661Z","text":"Ran it as a stranger: empty HOME, the plugin copied out of the marketplace rather than symlinked back, env -i so nothing from this session leaked in. tm install → tm/tm-dashboard/tm-hook on PATH; tm init → board plus git contract; epic, task, start; tm-dashboard → serves its page, its board, and its committed bundle with no npm install. doctor clean. The board identified itself as acme/stranger and recorded 'A Stranger <stranger@example.com>' as owner, so TM-036/TM-041/TM-045 hold for someone who is not me. Nothing needed fixing during the run — because the one thing that would have broken it was TM-046, found by asking this question and fixed first. Now a suite (tests/test-install.sh), so the next documented-but-untried step fails here instead of in someone's terminal."}]
closed: "2026-07-31T09:02:49.726Z"
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
