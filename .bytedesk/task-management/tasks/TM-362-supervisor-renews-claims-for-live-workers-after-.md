---
id: "TM-362"
kind: "task"
status: "done"
created: "2026-10-05T10:57:09.687Z"
board: "bytedeskai/bytedesk-marketplace"
title: "supervisor renews claims for live workers after a one-shot tm dispatch exits"
epic: "EP-028"
acceptance: [{"text":"A live worker's claim is renewed past the 240-minute expiry with no dispatching process","done":true,"at":"2026-10-05T14:15:17.814Z"},{"text":"A dead worker's claim is not renewed","done":true,"at":"2026-10-05T14:15:18.268Z"}]
evidence: [".bytedesk/task-management/evidence/TM-362-1791209718695.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/199","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-2"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:35:01.183Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T13:17:13.371Z","text":"Queued for EP-028 worker w-pool (same PR as its lead task); will be claimed when a WIP slot frees."},{"author":"review-sweep","ts":"2026-10-05T15:18:28.994Z","text":"review-sweep: TM-362 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:35:01.178Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/199 (independent post-merge review rv-203; TM-358 and TM-363 criteria met; TM-362 fixes TM-439 TM-440)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-362-1791209718695.log":{"source":null,"sha256":"ca89439e87f3b507c0b75cfb285592cb941f306831912e9fcd155727ad07074c","bytes":324,"at":"2026-10-05T14:15:18.697Z"}}
closed: "2026-10-05T14:15:19.136Z"
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (C2). Heartbeat is a setInterval in the dispatching process (lib/dispatch/index.mjs) and dies with a CLI dispatch.