---
id: "TM-373"
kind: "task"
status: "done"
created: "2026-10-05T10:57:19.303Z"
board: "bytedeskai/bytedesk-marketplace"
title: "doctor reports plugin freshness against origin/main"
epic: "EP-028"
acceptance: [{"text":"doctor shows installed plugin SHA vs origin/main and flags a stale cache","done":true,"at":"2026-10-05T14:15:06.610Z"}]
evidence: [".bytedesk/task-management/evidence/TM-373-1791209707029.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/201","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-2"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:53:13.907Z"
priority: "medium"
evidenceSources: {".bytedesk/task-management/evidence/TM-373-1791209707029.log":{"source":null,"sha256":"68c5403583cec457665b85b3da92b636a8b509eb530fa9d315aedaad6f714599","bytes":324,"at":"2026-10-05T14:15:07.030Z"}}
closed: "2026-10-05T14:15:07.466Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:31.328Z","text":"review-sweep: TM-373 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:53:13.902Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/201 (independent post-merge review rv-195; fixes TM-463 TM-464)"}]
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (F0d). Stale caches caused repeated confusion in gateway sessions.