---
id: "TM-267"
kind: "task"
status: "done"
created: "2026-10-01T06:59:11.320Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Make NATS mailbox acceptance durable and observable"
epic: "EP-022"
acceptance: [{"text":"NATS crash and redelivery tests prove durable acceptance and replay for mail and replies","done":true,"at":"2026-10-01T08:37:32.690Z"},{"text":"Held NATS messages resume publication with immutable identity and payload-bound deduplication","done":true,"at":"2026-10-01T08:37:32.946Z"},{"text":"CLI and MCP expose receipts without conflating mail receipt with task ownership","done":true,"at":"2026-10-01T08:37:33.227Z"}]
evidence: [".bytedesk/task-management/evidence/TM-267-1790842003029.log",".bytedesk/task-management/evidence/TM-267-1790843851106.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/141"]
blockedBy: []
blocks: []
actor: "main"
session: "01a0f4e3-7174-7ea2-b381-196dd4666765"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
triagedBy: "human"
updated: "2026-10-01T08:37:33.502Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-267-1790842003029.log":{"source":null,"sha256":"a94bdc352b7e24b32e9dc7d6bf1b1e06344a7e57e3920411174812384d32cc57","bytes":893,"at":"2026-10-01T08:06:43.030Z"},".bytedesk/task-management/evidence/TM-267-1790843851106.log":{"source":null,"sha256":"6ce6f687c5e772072d0765d07763435bb1b5412485219b492e5597c2cba79523","bytes":3631,"at":"2026-10-01T08:37:31.106Z"}}
closed: "2026-10-01T08:37:33.498Z"
---

Persist recipient obligations before ACK, normalize immutable message identity, recover held messages through NATS, expose nondestructive receipts and dispositions. Own AO mailbox/transport and tests.