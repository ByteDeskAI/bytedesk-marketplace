---
id: "TM-313"
kind: "task"
status: "open"
created: "2026-10-03T02:21:56.740Z"
board: "bytedeskai/bytedesk-marketplace"
title: "remote-gateway: per-agent orch grants incl. JetStream/KV/object subjects, TM and events buckets, credential expiry"
epic: "EP-026"
acceptance: [{"text":"Minted lead/worker creds can pull mail, use KV and ack","done":false},{"text":"Cross-agent subject access refused with printed text","done":false},{"text":"go test passes","done":false}]
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
updated: "2026-10-03T08:48:02.316Z"
comments: [{"author":"main","ts":"2026-10-03T08:48:02.310Z","text":"Implemented on branch nats/orch-grants, draft PR https://github.com/ByteDeskAI/bytedesk-remote-gateway/pull/335. Left open until a human merges."}]
---

Fix orchGrants gap, add TM_* and ORCH_EVENTS layout, expiry+rotation, revocation drops connection. CONTRACT.md section 4.