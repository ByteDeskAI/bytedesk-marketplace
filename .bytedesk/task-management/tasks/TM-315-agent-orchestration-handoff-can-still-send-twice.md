---
id: "TM-315"
kind: "task"
status: "open"
created: "2026-10-03T04:06:52.923Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: handoff can still send twice when the recipient consumed the successor before a retry"
epic: "EP-026"
acceptance: [{"text":"Test: successor consumed, then retry after the dedupe window, prints one delivery","done":false},{"text":"Test fails with the recipient-side record removed","done":false}]
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
updated: "2026-10-03T08:48:00.232Z"
comments: [{"author":"main","ts":"2026-10-03T08:48:00.224Z","text":"Implemented on branch nats/integration, draft PR https://github.com/ByteDeskAI/bytedesk-marketplace/pull/179 (verification in the PR body and docs/nats-native/FINDINGS.md). Left open until a human merges and the acceptance criteria are checked against main."}]
---

TM-311 limit: the retry check sees only unconsumed stream messages. Needs a recipient-side idempotency record (KV create keyed by successor id on consume). See docs/nats-native/FINDINGS.md on branch nats/integration.