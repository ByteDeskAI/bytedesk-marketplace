---
id: "TM-482"
kind: "task"
status: "done"
created: "2026-10-08T23:12:18.526Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration NATS mailbox: one invalid message blocks an agent's inbox forever (NAK + redeliver-first)"
epic: "EP-028"
acceptance: [{"text":"TOPOLOGY_MAILBOX_* validation failures are quarantined (record written) and the message ACKed/termed; only I/O errors NAK","done":true,"at":"2026-10-09T01:50:47.889Z"},{"text":"Test: an invalid message ahead of a valid one; the valid one is delivered and the invalid one is quarantined","done":true,"at":"2026-10-09T01:50:48.371Z"}]
evidence: [".bytedesk/task-management/evidence/TM-482-1791510649212.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/229"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-10-09T01:50:50.203Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-08T23:13:16.521Z","text":"Owned by the EP-028 lead (agent-comms-reliability-plan session), per agreement 2026-10-08; PR against main after independent review, lands after 0.16.1 (target 0.16.2)."},{"author":"main","ts":"2026-10-08T23:28:59.498Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/229 (independent review rv-229: F1 mailbox resume hides failures, F2 reply-id squat, F3 page spam, F4 lost page, F5 EACCES aborts retries, F6 skipped records never escalated)"},{"author":"main","ts":"2026-10-08T23:52:38.464Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/229 @ 8ac757cd (independent delta review rv-229: F1-F6 and N1-N3 fixed; TM-483 AC2 split to TM-486)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-482-1791510649212.log":{"source":null,"sha256":"2ff2b0be7b6a8d4894dd140bc28dec855c3a4a30ce3de83afa29627426d87cd7","bytes":184,"at":"2026-10-09T01:50:49.213Z"}}
closed: "2026-10-09T01:50:50.192Z"
---

Post-merge review of PR #141 (TM-267), reproduced on an isolated broker: when acceptMailboxDelivery throws, the message is NAKed and redelivered first on every read (standing-mailbox.mjs:300-304, mailbox.mjs:147-151), so a body of '   ' before a valid envelope makes readStandingInbox throw every time and the valid message is never read. Other triggers: bad digest, body over 1 MiB, orchName collision (a.b vs a_b, orch-transport.mjs:53-61).