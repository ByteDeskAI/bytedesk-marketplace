---
id: "TM-326"
kind: "task"
status: "open"
created: "2026-10-03T07:33:39.937Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: unit tests leave nats-server processes running (tm-leaf-*, tm-nats-*)"
epic: "EP-026"
acceptance: [{"text":"After npm test, no nats-server with a /tmp/tm-* store remains (printed ps)","done":false},{"text":"Check fails when a test leaks one","done":false}]
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
updated: "2026-10-03T08:48:00.601Z"
comments: [{"author":"main","ts":"2026-10-03T08:48:00.596Z","text":"Implemented on branch nats/integration, draft PR https://github.com/ByteDeskAI/bytedesk-marketplace/pull/179 (verification in the PR body and docs/nats-native/FINDINGS.md). Left open until a human merges and the acceptance criteria are checked against main."}]
---

Found 7 servers 1-4 hours old after the EP-026 workers' test runs. Every test that starts a server needs t.after teardown and the suite needs an end-of-run leak check like agent-orchestration's.