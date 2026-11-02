---
id: "TM-314"
kind: "task"
status: "done"
created: "2026-10-03T02:28:53.194Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: slot-grant notices are sent with no sender identity and are permanently held"
epic: "EP-028"
acceptance: [{"text":"a slot grant reaches the grantee's inbox with status delivered (test reads the inbox)","done":true,"at":"2026-10-05T13:15:29.638Z"},{"text":"every sendStandingMessage caller passes an admitted sender identity (grep audit recorded)","done":true,"at":"2026-10-05T13:15:30.047Z"}]
evidence: [".bytedesk/task-management/evidence/TM-314-1791206130437.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/195","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/211"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:53:10.938Z"
comments: [{"author":"main","ts":"2026-10-05T12:31:29.479Z","text":"Actively in progress (2026-10-05): EP-028 lead's worker w-send is implementing this in an isolated worktree; PR to follow. Not stale — do not park or re-dispatch."},{"author":"review-sweep","ts":"2026-10-05T15:18:25.895Z","text":"review-sweep: TM-314 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:31:41.364Z","text":"Superseded: the earlier 'actively in progress' note no longer applies — this task is done (see evidence)."},{"author":"main","ts":"2026-10-05T15:53:10.933Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/195 (independent post-merge review rv-195; fixes TM-462 TM-464)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-314-1791206130437.log":{"source":null,"sha256":"2fbe8424edb47da7237aa7a997b442cd396c554f45dc99577a4a7879b947c62a","bytes":233,"at":"2026-10-05T13:15:30.438Z"}}
closed: "2026-10-05T13:15:30.787Z"
---

Found by the TM-308/309 worker (2026-10-03): slots.mjs notifyGrants sends standing mail without from/fromProject, so every slot-grant ring is held as source_identity_required (same defect as TM-309 C1, fixed for NATS outage notices in PR #171 by sending as 'ao-supervisor' with fromProject = consumer and v2 message ids). Apply the same: admitted sender identity, v2 ids so existing held grant records don't raise TOPOLOGY_MESSAGE_ID_CONFLICT, held != sent, and a test that reads the grantee's real inbox. Audit every other sendStandingMessage caller for a missing sender.