---
id: "TM-096"
kind: "task"
status: "blocked"
created: "2026-09-05T04:01:43.693Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Durable role-sessions that survive restart"
epic: "EP-014"
acceptance: [{"text":"A role-session has a stable identity independent of any single run","done":false},{"text":"Reattaching to an existing role-session works rather than creating a duplicate","done":false},{"text":"Session state survives a restart of the orchestrator process","done":false},{"text":"The interaction with gateway tab restore is defined so a session is not silently recreated with the wrong command","done":false}]
evidence: []
commits: []
blockedBy: ["TM-088"]
blocks: ["TM-097","TM-101"]
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T04:17:47.084Z"
---

Both ao layers are run-oriented: spawn, work, finish, tear the tmux session down. A role bound to a project needs to be session-oriented - a named workspace you call rather than launch, that survives a restart and keeps its identity. This is a prerequisite for the team lead, since a lead that loses identity on restart is not a lead. The gateway already models durability on its side: a tab is a record in GATEWAY_HOME/terminal-tabs.json and the tmux session is derived from it, and tab restore recreates or reattaches sessions after a cutover from the record's stored Command - so a session the gateway does not know will not survive that path, and one it does know may be recreated with the record's command rather than the one that was launched.