---
id: "TM-293"
kind: "task"
status: "open"
created: "2026-10-02T13:28:11.913Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: 4 topology-management tests (landing and governed completion) fail on the base branch"
epic: "EP-021"
acceptance: [{"text":"The four failing tests are named with their cause, measured on a clean worktree at a recorded commit","done":false},{"text":"Each is fixed, or has a tracked reason if it cannot be, and the topology-management file passes","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace.git"]
blockedBy: []
blocks: []
actor: "main"
session: "81e61d16-ae0f-495c-a2a4-7148fc8fa898"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-03T06:24:26.797Z"
---

Reported by the TM-290 worker: after its fixes the unit run is 927/935, and 4 failures in topology-management (landing, governed completion) fail identically with the TM-290 guard off in that untouched file, so they predate it. Identify which tests, the cause, and fix or quarantine with a reason. TM-256 (test 23, inherited operator TMUX) may be one of them; do not assume. Measure on a clean worktree and record commit and dirty state.