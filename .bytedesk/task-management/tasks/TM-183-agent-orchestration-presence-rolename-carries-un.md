---
id: "TM-183"
kind: "task"
status: "open"
created: "2026-09-11T20:13:02.551Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: presence roleName carries unsanitised role text, including terminal escapes, to consumers"
epic: "EP-019"
acceptance: [{"text":"Roles are validated at definition time (agent new, spec) or C0 controls and DEL are stripped before roleName is published, with the choice recorded","done":false},{"text":"A presence fixture with an escape in roleName is rejected by the producer-side check","done":false},{"text":"The gateway is told the rule in the same request thread as the role-icon contract","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "8e87dbc7-3321-4e05-8648-b64d7c6319bb"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-11T20:36:43.809Z"
labels: ["plugin:agent-orchestration","ready-for-agent"]
comments: [{"author":"main","ts":"2026-09-11T20:36:43.802Z","text":"W5 (TM-168) adds: the pane title set by select-pane -T in launch.mjs preparePane still receives the raw declared role until the sanitised launcher OSC 2 title replaces it. Values written to tmux options and the OSC 2 title are now stripped of control characters (util.mjs terminalText, tmux.mjs tmuxText); select-pane -T text was left unchanged by decision because the gateway parses it."}]
triagedBy: "auto"
---

Found by W6 during TM-168 (2026-09-11). A run agent declared with role ESC]0;owned BEL produced a presence roleName containing the raw ESC byte (existing TM-136 behaviour); roleIcon and roleLabel correctly fell back to the unknown-role pair. agent new --role is not slug-checked (cli.mjs agent new, agents.mjs createAgent), so any consumer rendering roleName verbatim can be sent terminal control sequences. Documented as a known limit in PRESENCE-ROLE-ICON-ADDENDUM.md section 8 and the gateway request section 6.