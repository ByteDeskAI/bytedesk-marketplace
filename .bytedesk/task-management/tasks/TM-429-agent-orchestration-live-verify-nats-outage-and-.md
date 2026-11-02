---
id: "TM-429"
kind: "task"
status: "done"
created: "2026-10-05T15:28:14.820Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: live-verify NATS outage and recovery mail reach a lead's inbox exactly once (TM-309 AC1)"
epic: "EP-028"
acceptance: [{"text":"In an isolated state root on this machine, one outage and one recovery reach the lead inbox with status delivered","done":true,"at":"2026-10-05T15:32:05.765Z"},{"text":"Commands and inbox output attached as evidence","done":true,"at":"2026-10-05T15:32:06.242Z"}]
evidence: [".bytedesk/task-management/evidence/TM-429-tm429-evidence.log"]
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:32:06.713Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-429-tm429-evidence.log":{"source":"/tmp/claude-1000/tm429-evidence.log","sha256":"796170519d32470543cebd39e6632715315c51c8d15c01d0916c48ca10206969","bytes":4589,"at":"2026-10-05T15:32:05.044Z"}}
comments: [{"author":"main","ts":"2026-10-05T15:32:05.407Z","text":"Live PASS on origin/main 63458d7c in an isolated state root: inbox shows exactly 1 outage + 1 recovery from ao-supervisor (receiver status 'accepted'); sender records for both are 'delivered' to lead-1. Note: 'mailbox inbox' lists receiver receipts and can never print 'delivered' (a sender-side status); AC1's 'status delivered' is read from the sender records."}]
closed: "2026-10-05T15:32:06.708Z"
---

TM-309 closed with AC1 proven by tests only. Safe live procedure: throwaway repo and state root, AO_NATS_URL at a dead port, run ao-topology supervise once, then a separate JetStream nats-server on that port; read the lead's inbox. Never touch /etc/nats or ao's managed server.