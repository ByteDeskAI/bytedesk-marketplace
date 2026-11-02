---
id: "TM-498"
kind: "task"
status: "open"
created: "2026-10-09T02:11:19.054Z"
board: "bytedeskai/bytedesk-marketplace"
title: "liveness checks treat a thread id as a live process (kill(pid,0) accepts tids)"
epic: "EP-028"
acceptance: [{"text":"One shared isProcessAlive(pid) checks /proc/<pid>/status Tgid == pid (and start time where recorded), used by every liveness check in both plugins (each its own copy)","done":false},{"text":"A test with a thread id proves it is not treated as a live process","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T02:11:19.075Z"
---

Found by the TM-490 worker: kill(pid, 0) succeeds for a thread id (e.g. pid 999999 was a thread of a node process), so staleLock and other liveness checks (singleton, pool, agents, AO lockfile) can see a dead holder as alive. Bounded today because stale locks age out.