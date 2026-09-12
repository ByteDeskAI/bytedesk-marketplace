---
id: "TM-173"
kind: "task"
status: "open"
created: "2026-09-11T18:56:36.776Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm evidence double-prefixes an epic's own id (EP-020-EP-020-LANDING.md)"
acceptance: [{"text":"tm evidence <EP-nnn> with a filename already starting with that EP-nnn stores it without a second prefix","done":false},{"text":"The prefix check covers every id kind the store issues (TM, EP, ADR, CAP), with a test per kind","done":false}]
evidence: []
commits: ["cd1b1ac"]
blockedBy: []
blocks: []
actor: "main"
session: "8e87dbc7-3321-4e05-8648-b64d7c6319bb"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-11T19:49:39.471Z"
labels: ["plugin:task-management"]
---

Observed 2026-09-11 while closing EP-020: tm evidence EP-020 <scratchpad>/EP-020-LANDING.md stored the file as .bytedesk/task-management/evidence/EP-020-EP-020-LANDING.md. TM-166 fixed the double prefix for a filename carrying a different task's id, and TM-145 for a task's own TM- id; an epic (EP-) id carried in the filename is still prefixed again. Same command on TM-164 with TM-164-VERIFICATION.md stored TM-164-VERIFICATION.md correctly, so the gap looks specific to non-TM id prefixes.