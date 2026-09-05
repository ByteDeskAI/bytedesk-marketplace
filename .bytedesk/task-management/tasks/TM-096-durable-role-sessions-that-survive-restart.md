---
id: "TM-096"
kind: "task"
status: "done"
created: "2026-09-05T04:01:43.693Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Durable role-sessions that survive restart"
epic: "EP-014"
acceptance: [{"text":"A role-session has a stable identity independent of any single run","done":true,"at":"2026-09-05T10:26:22.585Z"},{"text":"Reattaching to an existing role-session works rather than creating a duplicate","done":true,"at":"2026-09-05T10:26:22.784Z"},{"text":"Session state survives a restart of the orchestrator process","done":true,"at":"2026-09-05T10:26:22.947Z"},{"text":"The interaction with gateway tab restore is defined so a session is not silently recreated with the wrong command","done":true,"at":"2026-09-05T10:26:23.113Z"}]
evidence: [".bytedesk/task-management/evidence/TM-096-two-projects.sh"]
commits: ["e0ec159","2d67bc2"]
blockedBy: ["TM-088"]
blocks: ["TM-097","TM-101"]
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T10:26:26.750Z"
parkedReason: "session ended (b0124774-6c67-41ff-9359-e1a31565e734)"
comments: [{"author":"main","ts":"2026-09-05T10:26:23.457Z","text":"Delivered as ao-topology session open|list|close. openRoleSession was library-only until this commit; the CLI is what makes the capability reachable."}]
closed: "2026-09-05T10:26:26.745Z"
---

Both ao layers are run-oriented: spawn, work, finish, tear the tmux session down. A role bound to a project needs to be session-oriented - a named workspace you call rather than launch, that survives a restart and keeps its identity. This is a prerequisite for the team lead, since a lead that loses identity on restart is not a lead. The gateway already models durability on its side: a tab is a record in GATEWAY_HOME/terminal-tabs.json and the tmux session is derived from it, and tab restore recreates or reattaches sessions after a cutover from the record's stored Command - so a session the gateway does not know will not survive that path, and one it does know may be recreated with the record's command rather than the one that was launched.