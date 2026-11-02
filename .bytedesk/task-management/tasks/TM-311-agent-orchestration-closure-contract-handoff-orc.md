---
id: "TM-311"
kind: "task"
status: "open"
created: "2026-10-03T02:21:55.656Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: closure-contract handoff, ORCH_EVENTS stream, KV watch, fenced claims, work queue (Phases 1-3)"
epic: "EP-026"
acceptance: [{"text":"Duplicate id at +0s and +150s yields one successor (stream count printed)","done":false},{"text":"Stale claim write refused, winner id printed","done":false},{"text":"Run once with no lead ack and the gate refuses","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/179"]
blockedBy: []
blocks: []
actor: "main"
session: "177a0074-f13b-446a-92db-45e161f580ba"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-03T08:47:59.335Z"
comments: [{"author":"main","ts":"2026-10-03T08:47:59.330Z","text":"Implemented on branch nats/integration, draft PR https://github.com/ByteDeskAI/bytedesk-marketplace/pull/179 (verification in the PR body and docs/nats-native/FINDINGS.md). Left open until a human merges and the acceptance criteria are checked against main."}]
---

Idempotent handoff via ORCH_HANDOFFS create; events stream; waitForReplies watch with poll fallback; fenced claims; ORCH_TASKS pull. CONTRACT.md sections 3, 6.