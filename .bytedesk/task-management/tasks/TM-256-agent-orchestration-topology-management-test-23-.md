---
id: "TM-256"
kind: "task"
status: "open"
created: "2026-09-27T02:13:55.632Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: topology-management test 23 fails when the suite inherits an operator TMUX"
epic: "EP-019"
acceptance: [{"text":"The test blanks TMUX and TMUX_PANE in the env it passes, and passes with an inherited operator TMUX","done":false},{"text":"No other tests/unit test inherits TMUX","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/137"]
blockedBy: []
blocks: []
actor: "main"
session: "b41d685d-7094-4957-80a5-950b76fb0467"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-02T13:11:04.387Z"
comments: [{"author":"main","ts":"2026-09-28T21:11:42.617Z","text":"Fixed by TM-264 (PR 137, 5408a65c61a6d295537560c8720c1d3f89f60106): the implicit-server case in topology-management.test.mjs now clears TMUX."},{"author":"@dc778cb2","ts":"2026-10-02T13:11:04.383Z","text":"TM-006 audit: AC1 on main (c3888f80); AC2 (preflight 382a2f71) only on fix/ao-local-nats-autostart. Close when that branch reaches main."}]
---

tests/unit/topology-management.test.mjs:564 expects error 'implicit server' but gets 'Pane must be observed alive in the task-owned worktree.' when run inside tmux. With TMUX= TMUX_PANE= it passes 25/25. Reproduced on clean origin/main 8b26684 on 2026-09-26 (fresh worktree, npm ci). Violates .claude/rules/tmux-test-isolation.md rule 1.