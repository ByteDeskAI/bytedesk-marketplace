---
id: "TM-186"
kind: "task"
status: "open"
created: "2026-09-11T20:54:18.969Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: supervise may keep running after it retires, because watchServer is never stopped"
epic: "EP-019"
acceptance: [{"text":"Reproduce or refute on an isolated tmux server: start supervise for a temp repository, remove the repository, and record whether the process exits and within what time","done":false},{"text":"If it does not exit, retirement aborts the watcher too, and a test proves the process exits after its consumer is removed","done":false}]
evidence: []
commits: ["c22a3b4"]
blockedBy: []
blocks: []
actor: "main"
session: "8e87dbc7-3321-4e05-8648-b64d7c6319bb"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-09-12T01:45:12.128Z"
---

Found by W4 during TM-167 (2026-09-11), by reading only. cli.mjs supervise returns Promise.all([owned(superviseRepository ...), watchServer(...)]). When superviseRepository retires because its consumer directory is gone (supervision.mjs consumer-gone path), the watchServer promise has no stop signal tied to it, so the process may stay alive watching the default server after the supervisor itself has stopped. The 5 long-lived ao-topology-run supervisors on this machine (days old, consumers under /tmp) may be this or plain test teardown leaks; not yet distinguished.