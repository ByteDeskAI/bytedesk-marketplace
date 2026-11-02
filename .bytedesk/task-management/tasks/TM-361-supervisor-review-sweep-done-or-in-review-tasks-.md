---
id: "TM-361"
kind: "task"
status: "done"
created: "2026-10-05T10:57:08.755Z"
board: "bytedeskai/bytedesk-marketplace"
title: "supervisor review sweep: done or in-review tasks with no verdict or an idle PR get a review or a lead notice"
epic: "EP-028"
acceptance: [{"text":"Sweep finds tasks without a reviewer verdict or with an idle open PR","done":true,"at":"2026-10-05T14:15:26.785Z"},{"text":"Each finding dispatches a review or notifies the lead exactly once","done":true,"at":"2026-10-05T14:15:27.134Z"},{"text":"A clean board reports zero findings with coverage counts","done":true,"at":"2026-10-05T14:15:27.520Z"}]
evidence: [".bytedesk/task-management/evidence/TM-361-1791209727945.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/203","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-2"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:34:59.624Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T13:17:14.782Z","text":"Queued for EP-028 worker w-guard (same PR as its lead task); will be claimed when a WIP slot frees."},{"author":"review-sweep","ts":"2026-10-05T15:18:28.637Z","text":"review-sweep: TM-361 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:34:59.620Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/203 (independent post-merge review rv-203; fixes TM-436 TM-437 TM-438)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-361-1791209727945.log":{"source":null,"sha256":"f22888e4257b7fb4a6cd6b3743b24f3c97f18e832f896646a4fa70db38a033eb","bytes":324,"at":"2026-10-05T14:15:27.946Z"}}
closed: "2026-10-05T14:15:28.360Z"
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (C1). Complements TM-244.