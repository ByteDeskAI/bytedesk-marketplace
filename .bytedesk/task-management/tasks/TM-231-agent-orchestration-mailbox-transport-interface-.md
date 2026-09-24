---
id: "TM-231"
kind: "task"
status: "open"
created: "2026-09-24T21:08:03.527Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: mailbox transport interface (file-backed now, NATS later)"
epic: "EP-021"
acceptance: [{"text":"All mailbox, claim, presence, probe and verdict I/O goes through one transport interface; file transport passes the existing suite unchanged","done":false},{"text":"Interface documented with the NATS subject/KV mapping from gateway TM-452","done":false},{"text":"A conformance test suite any transport must pass","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: ["TM-232"]
actor: "main"
session: "1b07de2e-6b73-47c6-ad14-aa29eeea67fd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-24T22:26:41.106Z"
comments: [{"author":"main","ts":"2026-09-24T22:26:41.100Z","text":"Gateway link (from gateway lead d60f0608, 2026-09-24): client side of gateway TM-450 (orch listener), TM-451 (orch credentials), TM-452 (orch stream/KV/object layout)."}]
---

Operator decision 2026-09-24: agent communication goes NATS-native on the gateway's embedded server (in-process now, movable to a sidecar later); gateway work is TM-450 (orch listener), TM-451 (orch credentials), TM-452 (orch stream/KV/object layout). Put mail, claims, presence, probes and review verdicts behind one transport interface in agent-orchestration, backed by today's files, so a NATS transport can drop in without another rewrite. Include the reviewer's verdict path (publish-only), replacing pane scraping once the NATS transport exists.