---
id: "TM-289"
kind: "task"
status: "blocked"
created: "2026-10-02T04:28:56.711Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: process-compose restarts a supervisor that exits on purpose (retired repo, lock loser) every 3 s"
epic: "EP-023"
acceptance: [{"text":"a supervisor that retires (repo removed/unenrolled) is not restarted and its repo is removed from repos.json (test with the fake process-compose API / rendered project)","done":false},{"text":"a lock-losing supervisor is retried with backoff and takes over once the holder exits (test)","done":false},{"text":"a crashing supervisor is still restarted (test); live: retiring a temp repo leaves restarts unchanged","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/151"]
blockedBy: []
blocks: []
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-02T13:15:10.911Z"
priority: "high"
links: [{"type":"relates to","id":"TM-186"}]
comments: [{"author":"main","ts":"2026-10-02T05:26:59.893Z","text":"Shipped locally at 4db74896 (0.15.1). Live: deleted a temp registered repo → its supervisor retired in 3 s, left the project and repos.json, no restarts; all other processes restarts=0. Codex/Grok auto-refreshed to 0.15.1. PR opened (base #149)."}]
blockedReason: "awaiting human merge of its PR (shipped locally at 4db74896)"
---

Found by the TM-288 board review (reviewer A, from TM-186) and confirmed in code: src/services/services.mjs renders every supervise-<repo> process with availability restart 'always' (backoff 3 s), but ao-topology supervise exits 0 on purpose when (a) it retires because its repository was removed or unenrolled (cli.mjs ~367-384) and (b) it loses the per-repo lock to another supervisor (cli.mjs:358 'another-supervisor-owns-this-repository'). Under 'always', process-compose restarts both forever. Live today every supervisor shows restarts=0, so the loop has not triggered here yet. Fix: supervise restart policy 'on_failure' with distinct exit codes — a deliberate retirement exits 0 (not restarted) and deregisters the repo from repos.json; a lock loser exits with a non-zero 'try later' code so it is retried with backoff and takes over when the holder ends; a crash stays non-zero.