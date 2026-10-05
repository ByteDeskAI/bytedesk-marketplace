---
id: "TM-314"
kind: "task"
status: "open"
created: "2026-10-03T02:28:53.194Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: slot-grant notices are sent with no sender identity and are permanently held"
epic: "EP-019"
acceptance: [{"text":"a slot grant reaches the grantee's inbox with status delivered (test reads the inbox)","done":false},{"text":"every sendStandingMessage caller passes an admitted sender identity (grep audit recorded)","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-03T02:40:20.150Z"
---

Found by the TM-308/309 worker (2026-10-03): slots.mjs notifyGrants sends standing mail without from/fromProject, so every slot-grant ring is held as source_identity_required (same defect as TM-309 C1, fixed for NATS outage notices in PR #171 by sending as 'ao-supervisor' with fromProject = consumer and v2 message ids). Apply the same: admitted sender identity, v2 ids so existing held grant records don't raise TOPOLOGY_MESSAGE_ID_CONFLICT, held != sent, and a test that reads the grantee's real inbox. Audit every other sendStandingMessage caller for a missing sender.