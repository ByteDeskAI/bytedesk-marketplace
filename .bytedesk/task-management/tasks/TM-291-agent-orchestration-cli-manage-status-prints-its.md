---
id: "TM-291"
kind: "task"
status: "open"
created: "2026-10-02T13:07:30.329Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration CLI: 'manage status' prints its result and then never exits"
epic: "EP-019"
acceptance: [{"text":"manage status exits 0 within 5 s of printing; a CLI test asserts the process exits","done":false},{"text":"every manage verb is checked for the same leak","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "@dc778cb2"
session: "dc778cb2"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-02T13:07:33.606Z"
---

Observed 2026-10-02 (ao 0.15.1, served branch 35488ce2): 'ao-topology manage status --task TM-195 --summary' (and --json) prints its result immediately and then hangs until killed (timeout 60 => exit 124, 0.28 s CPU). manage admit and start-worker exit normally. Likely an open handle (NATS connection, watcher or timer) that status opens and never closes. Any script or agent calling it blocks.