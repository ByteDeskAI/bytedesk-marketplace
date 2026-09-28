---
id: "TM-231"
kind: "task"
status: "done"
created: "2026-09-24T21:08:03.527Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: mailbox transport interface (file-backed now, NATS later)"
epic: "EP-021"
acceptance: [{"text":"All mailbox, claim, presence, probe and verdict I/O goes through one transport interface; file transport passes the existing suite unchanged","done":true,"at":"2026-09-28T03:34:47.099Z"},{"text":"Interface documented with the NATS subject/KV mapping from gateway TM-452","done":true,"at":"2026-09-28T03:34:47.318Z"},{"text":"A conformance test suite any transport must pass","done":true,"at":"2026-09-28T03:34:47.541Z"}]
evidence: [".bytedesk/task-management/evidence/TM-231-nats-cases-1.log"]
commits: []
blockedBy: []
blocks: ["TM-232"]
actor: "main"
session: "01a0e5f6-3b57-7df3-b60f-5b1e3f234288"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-28T03:34:47.967Z"
comments: [{"author":"main","ts":"2026-09-24T22:26:41.100Z","text":"Gateway link (from gateway lead d60f0608, 2026-09-24): client side of gateway TM-450 (orch listener), TM-451 (orch credentials), TM-452 (orch stream/KV/object layout)."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-231-nats-cases-1.log":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-231-nats-cases-1.log","sha256":"6a90e965be9e1a17ebc40f1eb9085a128778783e9d780bd649213d0364c095a6","bytes":1391,"at":"2026-09-28T03:34:47.763Z"}}
closed: "2026-09-28T03:34:47.963Z"
---

Operator decision 2026-09-24: agent communication goes NATS-native on the gateway's embedded server (in-process now, movable to a sidecar later); gateway work is TM-450 (orch listener), TM-451 (orch credentials), TM-452 (orch stream/KV/object layout). Put mail, claims, presence, probes and review verdicts behind one transport interface in agent-orchestration, backed by today's files, so a NATS transport can drop in without another rewrite. Include the reviewer's verdict path (publish-only), replacing pane scraping once the NATS transport exists.