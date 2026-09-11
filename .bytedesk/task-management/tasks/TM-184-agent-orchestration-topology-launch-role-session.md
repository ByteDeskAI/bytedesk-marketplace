---
id: "TM-184"
kind: "task"
status: "open"
created: "2026-09-11T20:36:42.792Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: topology-launch role-session tests create and kill named sessions on the operator's tmux server when TMUX is inherited"
epic: "EP-019"
acceptance: [{"text":"Every test in topology-launch.test.mjs that touches tmux sets TMUX:'' and a per-test TMUX_TMPDIR, and scopes every kill-session with -S or -L","done":false},{"text":"A guard test (or the suite runner) fails when any tmux-touching test would inherit the caller's TMUX","done":false},{"text":"Running the topology suite from inside a tmux session creates no session on the caller's server, checked by listing the caller's server sessions before and after","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "8e87dbc7-3321-4e05-8648-b64d7c6319bb"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-09-11T20:36:43.584Z"
---

Found by W5 during TM-168 (2026-09-11). Running node --test --test-concurrency=1 tests/unit/topology-*.test.mjs from a shell inside tmux (TMUX set) made the existing role-session tests in tests/unit/topology-launch.test.mjs create and kill their own named sessions (ao-aatest01, ao-prompt01) on the OPERATOR's server. They ran no kill-server, but they violate .claude/rules/tmux-test-isolation.md rules 1 and 3 (no TMUX:'' and unscoped kill-session), and a session-name collision would kill a real agent session. Other sessions and workers have run the suite from inside tmux today. Workaround until fixed: run the suite with TMUX='' and a private TMUX_TMPDIR.