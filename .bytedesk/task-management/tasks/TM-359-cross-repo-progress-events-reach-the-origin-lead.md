---
id: "TM-359"
kind: "task"
status: "done"
created: "2026-10-05T10:57:07.059Z"
board: "bytedeskai/bytedesk-marketplace"
title: "cross-repo progress events reach the origin lead and origin task"
epic: "EP-028"
acceptance: [{"text":"Each lifecycle event produces one origin notification and one origin task comment","done":true,"at":"2026-10-05T14:15:23.649Z"},{"text":"Merge clears the origin dependency","done":true,"at":"2026-10-05T14:15:24.064Z"},{"text":"Live sandbox test across two repos","done":true,"at":"2026-10-05T14:15:24.474Z"}]
evidence: [".bytedesk/task-management/evidence/TM-359-1791209724908.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/197","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-2"]
blockedBy: ["TM-381","TM-357"]
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:37:05.162Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T13:17:12.597Z","text":"Queued for EP-028 worker w-ticket (same PR as its lead task); will be claimed when a WIP slot frees."},{"author":"review-sweep","ts":"2026-10-05T15:18:28.200Z","text":"review-sweep: TM-359 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:37:05.156Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/197 (independent post-merge review rv-197; fixes TM-446 TM-447 TM-450)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-359-1791209724908.log":{"source":null,"sha256":"165fbae2c1595f6cfe8763a90fd9919f4718b1f1bcd5f17d8959740e3494d78d","bytes":324,"at":"2026-10-05T14:15:24.909Z"}}
closed: "2026-10-05T14:15:25.369Z"
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (B4). PR opened, review verdict, merged, published, failed -> standing mail to origin lead + comment on origin task; merge clears the origin's cross-repo dependency.