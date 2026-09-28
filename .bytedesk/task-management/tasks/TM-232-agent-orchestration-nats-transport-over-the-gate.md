---
id: "TM-232"
kind: "task"
status: "done"
created: "2026-09-24T21:08:03.694Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: NATS transport over the gateway's orch listener"
epic: "EP-021"
acceptance: [{"text":"NATS transport passes the transport conformance suite","done":true,"at":"2026-09-28T03:34:48.858Z"},{"text":"Reviewer verdicts arrive via its verdict subject, not pane scraping","done":true,"at":"2026-09-28T03:34:49.061Z"},{"text":"A message accepted before a listener gap is still received after reconnect, without reading a mailbox file","done":true,"at":"2026-09-28T03:34:49.269Z"}]
evidence: [".bytedesk/task-management/evidence/TM-232-nats-cases-2.log"]
commits: []
blockedBy: ["TM-231"]
blocks: []
actor: "main"
session: "01a0e5f6-3b57-7df3-b60f-5b1e3f234288"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-28T03:34:49.739Z"
comments: [{"author":"main","ts":"2026-09-24T22:26:41.279Z","text":"Gateway link (from gateway lead d60f0608, 2026-09-24): client side of gateway TM-450 (orch listener), TM-451 (orch credentials), TM-452 (orch stream/KV/object layout)."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-232-nats-cases-2.log":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-232-nats-cases-2.log","sha256":"cec0402e7e0f186421f6d2fd48618a8bfeef4c6a0bdf03c5234565a3c90b42aa","bytes":1391,"at":"2026-09-28T03:34:49.499Z"}}
closed: "2026-09-28T03:34:49.735Z"
---

Follows the file-backed transport interface. Implement the NATS transport: connect over the gateway orch listener (gateway TM-450) with per-agent orch credentials (TM-451), use the TM-452 layout (ORCH_MAIL durable consumers, tasks.ready work queue, KV claims with compare-and-set, TTL presence, object store for review packets, request/reply probes, reviewer publish-only verdict subject). Fall back to the file transport while the gateway is restarting or absent, with no message loss.