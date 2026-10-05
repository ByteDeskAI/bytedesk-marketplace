---
id: "TM-312"
kind: "task"
status: "open"
created: "2026-10-03T02:21:56.200Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: pluggable storage backend, schema registry with upcasters, NATS backend, migration"
epic: "EP-026"
acceptance: [{"text":"Old schema value read through upcaster and rewritten at current schema; unknown fields preserved","done":false},{"text":"Higher-schema value is read-only, write refused","done":false},{"text":"tm board/next/start/done work on NATS backend; file backend still passes existing tests","done":false}]
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
updated: "2026-10-03T08:47:59.726Z"
comments: [{"author":"main","ts":"2026-10-03T08:47:59.718Z","text":"Implemented on branch nats/integration, draft PR https://github.com/ByteDeskAI/bytedesk-marketplace/pull/179 (verification in the PR body and docs/nats-native/FINDINGS.md). Left open until a human merges and the acceptance criteria are checked against main."}]
---

Backend interface + file and NATS backends, envelope/registry/upcasters, tm migrate with dry run, offline queue. CONTRACT.md sections 1,2,3,5.