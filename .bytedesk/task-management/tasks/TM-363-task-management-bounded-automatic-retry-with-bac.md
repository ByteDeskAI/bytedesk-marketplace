---
id: "TM-363"
kind: "task"
status: "done"
created: "2026-10-05T10:57:10.587Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: bounded automatic retry with backoff for task-scoped dispatch failures"
epic: "EP-028"
acceptance: [{"text":"Task-scoped failures retry up to a configured count with backoff before parking","done":true,"at":"2026-10-05T14:15:14.626Z"},{"text":"System-scoped failures still count toward the pool pause","done":true,"at":"2026-10-05T14:15:15.044Z"},{"text":"Retries are logged as events","done":true,"at":"2026-10-05T14:15:15.438Z"}]
evidence: [".bytedesk/task-management/evidence/TM-363-1791209715888.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/199","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-2"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:35:00.819Z"
priority: "medium"
comments: [{"author":"main","ts":"2026-10-05T13:17:13.030Z","text":"Queued for EP-028 worker w-pool (same PR as its lead task); will be claimed when a WIP slot frees."},{"author":"review-sweep","ts":"2026-10-05T15:18:29.211Z","text":"review-sweep: TM-363 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:35:00.814Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/199 (independent post-merge review rv-203; TM-358 and TM-363 criteria met; TM-362 fixes TM-439 TM-440)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-363-1791209715888.log":{"source":null,"sha256":"ca89439e87f3b507c0b75cfb285592cb941f306831912e9fcd155727ad07074c","bytes":324,"at":"2026-10-05T14:15:15.889Z"}}
closed: "2026-10-05T14:15:16.371Z"
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (C3). Today a failed worker is parked and needs a person.