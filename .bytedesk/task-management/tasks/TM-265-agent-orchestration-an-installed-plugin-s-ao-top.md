---
id: "TM-265"
kind: "task"
status: "done"
created: "2026-09-28T21:02:04.186Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: an installed plugin's ao-topology cannot use NATS, the default transport"
epic: "EP-019"
acceptance: [{"text":"ao-topology in an installed plugin tree (no node_modules) can open the NATS transport (bundle the topology CLI or ship nats)","done":true,"at":"2026-09-29T08:49:02.833Z"},{"text":"A contract test proves it against a clean-install tree","done":true,"at":"2026-09-29T08:49:06.295Z"}]
evidence: [".bytedesk/task-management/evidence/TM-265-1790671690713.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/138"]
blockedBy: []
blocks: ["TM-266"]
actor: "main"
session: "01a0e0a4-3a33-79c1-ab90-99e1b6c55113"
branch: "tm/TM-265-agent-orchestration-an-installed-plugin-s-ao-top"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-265-agent-orchestration-an-installed-plugin-s-ao-top"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-29T13:05:56.028Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-265-1790671690713.log":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-265-1790671690713.log","sha256":"96e399154d50e106416249ea7ac159471a34e9309ef50e6b797710e3679a7bce","bytes":1458,"at":"2026-09-29T09:05:20.237Z"}}
closed: "2026-09-29T08:49:10.456Z"
---

Found by TM-264 (2026-09-28): bin/ao-topology runs the unbundled topology/ tree, and an installed plugin cache ships no node_modules (clean-install contract), so the nats package is absent and NATS — the v0.11.0 default — fails with TOPOLOGY_NATS_UNAVAILABLE. dist/*.cjs inlines nats but the topology CLI does not use dist.