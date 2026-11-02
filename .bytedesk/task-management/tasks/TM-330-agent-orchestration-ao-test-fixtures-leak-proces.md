---
id: "TM-330"
kind: "task"
status: "open"
created: "2026-10-03T07:33:42.063Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: AO test fixtures leak process-compose service managers (/tmp/ao-act-*, /tmp/ao-ri-*)"
epic: "EP-026"
acceptance: [{"text":"No process-compose from a /tmp/ao-* home remains after the suite","done":false},{"text":"Leak check in the suite helper","done":false}]
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
updated: "2026-10-03T08:48:01.973Z"
comments: [{"author":"main","ts":"2026-10-03T08:48:01.968Z","text":"Implemented on branch nats/integration, draft PR https://github.com/ByteDeskAI/bytedesk-marketplace/pull/179 (verification in the PR body and docs/nats-native/FINDINGS.md). Left open until a human merges and the acceptance criteria are checked against main."}]
---

Dozens of process-compose instances from act-on, act-many and ri fixtures were found 9-10 hours old. Not from EP-026 workers. Tests that start services must stop them.