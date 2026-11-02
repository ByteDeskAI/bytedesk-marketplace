---
id: "TM-310"
kind: "task"
status: "open"
created: "2026-10-03T02:21:55.087Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: per-agent NATS credentials protected from sibling agents (Phase 0b)"
epic: "EP-026"
acceptance: [{"text":"Agent B cannot read A's creds or use A's subjects; refusal text printed","done":false},{"text":"Revoked agent's open connection drops; rotation works","done":false},{"text":"Existing unit suite green","done":false}]
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
updated: "2026-10-03T08:47:58.992Z"
comments: [{"author":"main","ts":"2026-10-03T08:47:58.988Z","text":"Implemented on branch nats/integration, draft PR https://github.com/ByteDeskAI/bytedesk-marketplace/pull/179 (verification in the PR body and docs/nats-native/FINDINGS.md). Left open until a human merges and the acceptance criteria are checked against main."}]
---

Per-agent nkey/JWT users, in-memory delivery, revocation drops live connections, negative test per grant. See scratchpad ao-sandbox/CONTRACT.md section 4.