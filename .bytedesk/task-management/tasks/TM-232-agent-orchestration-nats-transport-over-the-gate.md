---
id: "TM-232"
kind: "task"
status: "blocked"
created: "2026-09-24T21:08:03.694Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: NATS transport over the gateway's orch listener"
epic: "EP-021"
acceptance: [{"text":"NATS transport passes the transport conformance suite","done":false},{"text":"Fallback to files during gateway restart/absence and resync without loss; tests","done":false},{"text":"Reviewer verdicts arrive via its verdict subject, not pane scraping","done":false}]
evidence: []
commits: []
blockedBy: ["TM-231"]
blocks: []
actor: "main"
session: "1b07de2e-6b73-47c6-ad14-aa29eeea67fd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-24T22:26:41.284Z"
comments: [{"author":"main","ts":"2026-09-24T22:26:41.279Z","text":"Gateway link (from gateway lead d60f0608, 2026-09-24): client side of gateway TM-450 (orch listener), TM-451 (orch credentials), TM-452 (orch stream/KV/object layout)."}]
---

Follows the file-backed transport interface. Implement the NATS transport: connect over the gateway orch listener (gateway TM-450) with per-agent orch credentials (TM-451), use the TM-452 layout (ORCH_MAIL durable consumers, tasks.ready work queue, KV claims with compare-and-set, TTL presence, object store for review packets, request/reply probes, reviewer publish-only verdict subject). Fall back to the file transport while the gateway is restarting or absent, with no message loss.