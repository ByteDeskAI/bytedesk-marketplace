---
id: "TM-186"
kind: "task"
status: "open"
created: "2026-09-11T20:54:18.969Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: supervise may keep running after it retires, because watchServer is never stopped"
epic: "EP-019"
acceptance: [{"text":"Reproduce or refute on an isolated tmux server: start supervise for a temp repository, remove the repository, and record whether the process exits and within what time","done":false},{"text":"If it does not exit, retirement aborts the watcher too, and a test proves the process exits after its consumer is removed","done":false},{"text":"a CLI test removes the consumer and asserts the process exits","done":false}]
evidence: []
commits: ["c22a3b4","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/150"]
blockedBy: []
blocks: []
actor: "main"
session: "8e87dbc7-3321-4e05-8648-b64d7c6319bb"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["plugin:agent-orchestration","ready-for-human"]
triagedBy: "human"
updated: "2026-10-04T04:53:04.729Z"
comments: [{"author":"main","ts":"2026-10-02T05:14:26.731Z","text":"TM-288 board review (approved by Ryan 2026-10-02): the code fix landed silently in c0a66d6c (2026-09-22), but no CLI-level test proves 'supervise' exits. Added an AC for that test, and linked TM-289 (process-compose restarts a supervisor that exits on purpose)."}]
links: [{"type":"relates to","id":"TM-289"}]
---

Found by W4 during TM-167 (2026-09-11), by reading only. cli.mjs supervise returns Promise.all([owned(superviseRepository ...), watchServer(...)]). When superviseRepository retires because its consumer directory is gone (supervision.mjs consumer-gone path), the watchServer promise has no stop signal tied to it, so the process may stay alive watching the default server after the supervisor itself has stopped. The 5 long-lived ao-topology-run supervisors on this machine (days old, consumers under /tmp) may be this or plain test teardown leaks; not yet distinguished.