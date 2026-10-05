---
id: "TM-327"
kind: "task"
status: "open"
created: "2026-10-03T07:33:40.481Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: wait --message reports ok:true with zero replies when no such message exists"
epic: "EP-026"
acceptance: [{"text":"wait on an unknown message id exits non-zero with a named reason","done":false},{"text":"Existing wait behaviour for real pending messages unchanged","done":false}]
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
updated: "2026-10-03T08:48:00.944Z"
comments: [{"author":"main","ts":"2026-10-03T08:48:00.938Z","text":"Implemented on branch nats/integration, draft PR https://github.com/ByteDeskAI/bytedesk-marketplace/pull/179 (verification in the PR body and docs/nats-native/FINDINGS.md). Left open until a human merges and the acceptance criteria are checked against main."}]
---

Found in the EP-026 sandbox: wait for a nonexistent or not-yet-sent id returned {ok:true, replies:[]} and journalled wait.satisfied. A barrier with nothing to wait for must say so (TOPOLOGY_NOTHING_PENDING) rather than succeed.