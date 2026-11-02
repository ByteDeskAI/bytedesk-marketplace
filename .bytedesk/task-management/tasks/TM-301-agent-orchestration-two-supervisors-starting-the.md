---
id: "TM-301"
kind: "task"
status: "open"
created: "2026-10-02T21:19:30.144Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: two supervisors starting the first session on a fresh tmux socket orphan one server"
epic: "EP-019"
acceptance: [{"text":"Concurrent first-session creation on one fresh socket leaves exactly one tmux server (e.g. serialise first start per socket, or start the server explicitly under a lock before new-session)","done":false},{"text":"A contract test starts two enrolled repos' supervisors concurrently on a fresh socket and asserts one server pid","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "@@dc778cb2"
session: "dc778cb2"
branch: "tm/TM-298-agent-orchestration-contract-tests-still-launch-"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-298-agent-orchestration-contract-tests-still-launch-"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-02T21:19:37.835Z"
---

Found in TM-298 (topology-lead-recovery-tmux, 1 of 2 runs). Two repository supervisors sharing a TMUX_TMPDIR each ran new-session against a socket with no server yet; tmux started two servers, the second re-bound the socket path, and the first (holding source's lead session) was left running with no socket. Nothing can reach it by -S/-L: lead liveness, kill-pane, census and teardown all miss it, and a tmux -C control client attached to it ignored the server's SIGTERM. In production this can happen on a fresh boot / fresh socket when two enrolled repos activate at once, leaving an invisible orphaned lead. Tests now reap it by pid (killEnvServer, TM-298); the product does not.