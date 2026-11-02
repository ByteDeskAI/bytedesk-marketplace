---
id: "TM-357"
kind: "task"
status: "done"
created: "2026-10-05T10:57:05.329Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: notify the target lead of a cross-repo ticket and wake its pool"
epic: "EP-028"
acceptance: [{"text":"A ticket produces one standing message to the target lead naming id and priority","done":true,"at":"2026-10-05T14:15:20.542Z"},{"text":"The target pool ticks within seconds of the wake, not the 30s poll","done":true,"at":"2026-10-05T14:15:20.885Z"},{"text":"File transport fallback still delivers the notice","done":true,"at":"2026-10-05T14:15:21.242Z"}]
evidence: [".bytedesk/task-management/evidence/TM-357-1791209721662.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/197","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-2"]
blockedBy: ["TM-381"]
blocks: ["TM-359"]
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:37:04.767Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T13:17:12.268Z","text":"Queued for EP-028 worker w-ticket (same PR as its lead task); will be claimed when a WIP slot frees."},{"author":"review-sweep","ts":"2026-10-05T15:18:27.769Z","text":"review-sweep: TM-357 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:37:04.762Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/197 (independent post-merge review rv-197; fixes TM-446 TM-447 TM-450)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-357-1791209721662.log":{"source":null,"sha256":"165fbae2c1595f6cfe8763a90fd9919f4718b1f1bcd5f17d8959740e3494d78d","bytes":324,"at":"2026-10-05T14:15:21.663Z"}}
closed: "2026-10-05T14:15:22.059Z"
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (B2). Standing mail to the target lead with priority and ticket id; publish a wake to orch.<repo>.tasks.ready (the unused ORCH_TASKS stub) so the pool ticks immediately.