---
id: "TM-324"
kind: "task"
status: "done"
created: "2026-10-03T05:27:01.369Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: an unreachable AO_NATS_URL fails hard and stays failed until it answers (ADR-0035)"
epic: "EP-019"
acceptance: [{"text":"openNatsTransport with an unreachable AO_NATS_URL rejects TOPOLOGY_NATS_UNAVAILABLE, starts no managed local server, and records a blocking outage (source AO_NATS_URL, blocking true, fallback null) in transport.json under the caller's home; the first open that reaches the server closes it with recovered_at (nats-outage.test.mjs through the real connect path with a real nats-server)","done":true,"at":"2026-10-03T05:37:31.413Z"},{"text":"while the outage is open: a degraded supervisor tick still carries transport and nats_outage so the start log and tick log name it (transport-unavailable), doctor raises NATS_CONFIGURED_UNREACHABLE stating nothing on the host continues until the server answers, and no fallback is mentioned (tests)","done":true,"at":"2026-10-03T05:37:31.864Z"},{"text":"the lead receives exactly one outage mail and one recovery mail per outage; the outage mail is written durably while the server is down and is published when it answers again (test reads the lead's real inbox after recovery)","done":true,"at":"2026-10-03T05:37:32.230Z"},{"text":"a stale gateway orch.sock still falls back to managed local and is reported, and the TM-295 holder heartbeat keeps that outage open (existing tests re-pointed at orch.sock)","done":true,"at":"2026-10-03T05:37:32.621Z"},{"text":"npm run build then build:check pass; nats-outage.test.mjs and topology-supervision-transport.test.mjs pass with the test:unit preloads; CHANGELOG entry; package.json and src/mcp.mjs at 0.15.5","done":true,"at":"2026-10-03T05:37:32.975Z"}]
evidence: [".bytedesk/task-management/evidence/TM-324-checks.txt"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/tm/TM-324-agent-orchestration-ao-nats-url-fails-hard"]
blockedBy: []
blocks: []
actor: "main"
session: "b2e7895a-9532-4e62-bd7e-56fbe604b781"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-10-03T05:37:33.692Z"
priority: "high"
evidenceSources: {".bytedesk/task-management/evidence/TM-324-checks.txt":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-324-checks.txt","sha256":"f30ed0102538e23b00b2beee9d2e55bb86bd10849f53fb6a867e96fbb406f31a","bytes":3531,"at":"2026-10-03T05:37:30.968Z"}}
comments: [{"author":"main","ts":"2026-10-03T05:37:33.329Z","text":"READY-FOR-REVIEW: PR https://github.com/ByteDeskAI/bytedesk-marketplace/pull/176 (commit 117d2cac on tm/TM-324-agent-orchestration-ao-nats-url-fails-hard, base fix/ao-local-nats-autostart). nats-outage 8/8, supervision-transport 6/6, regression sweep 134 tests 0 fail, build + build:check exit 0, plugin validate ok. Implements ADR-0035 (operator decision at the parallel-review gate, run 20261002-212844-e4bx). Humans merge; plugin copies on other hosts update after merge (ADR-0031 item 4)."}]
closed: "2026-10-03T05:37:33.687Z"
---

Implements ADR-0035, the operator's decision on the D1 disagreement from the parallel review of PR #154 (run 20261002-212844-e4bx): an explicit AO_NATS_URL is never replaced by the managed local NATS. Today (TM-308, ao 0.15.4) an unreachable AO_NATS_URL falls back to managed local and is reported per ADR-0031, which can split a cross-machine team onto two buses. Change: openNatsTransport records a blocking outage (source AO_NATS_URL, blocking: true, no fallback) and fails with TOPOLOGY_NATS_UNAVAILABLE on every open until the server answers; the first open that reaches it closes the outage. Supervisors tick degraded and the degraded tick still runs natsOutageTick and reports the transport (today presence publish throws before the tick, so nothing would be mailed or logged). doctor and the lead's mail say that nothing on the host continues until the server answers; the outage mail is durable and lands when NATS answers again. orch.sock fallback and the port-conflict report are unchanged. Touches: topology/lib/orch-transport.mjs, topology/lib/nats-outage.mjs, topology/lib/supervision.mjs, topology/lib/doctor.mjs, topology/cli.mjs, tests/unit/nats-outage.test.mjs, dist/*, CHANGELOG, package.json + src/mcp.mjs (0.15.5).