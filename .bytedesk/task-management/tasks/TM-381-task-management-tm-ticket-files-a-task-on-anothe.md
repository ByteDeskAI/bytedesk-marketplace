---
id: "TM-381"
kind: "task"
status: "done"
created: "2026-10-05T10:57:35.942Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm ticket files a task on another repo's board with an origin back-link (CLI + MCP tm_ticket)"
epic: "EP-028"
acceptance: [{"text":"tm ticket creates the task in the target store with origin recorded","done":true,"at":"2026-10-05T14:14:56.929Z"},{"text":"The from-task option adds a cross-repo blocker on the origin task","done":true,"at":"2026-10-05T14:14:57.309Z"},{"text":"MCP tm_ticket does the same; works when agent-orchestration is absent","done":true,"at":"2026-10-05T14:14:57.678Z"}]
evidence: [".bytedesk/task-management/evidence/TM-381-1791209698057.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/197","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-2","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/221"]
blockedBy: []
blocks: ["TM-357","TM-359"]
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:37:04.342Z"
priority: "highest"
evidenceSources: {".bytedesk/task-management/evidence/TM-381-1791209698057.log":{"source":null,"sha256":"165fbae2c1595f6cfe8763a90fd9919f4718b1f1bcd5f17d8959740e3494d78d","bytes":324,"at":"2026-10-05T14:14:58.058Z"}}
closed: "2026-10-05T14:14:58.396Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:32.281Z","text":"review-sweep: TM-381 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:37:04.337Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/197 (independent post-merge review rv-197; fixes TM-446 TM-447 TM-450)"}]
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (B1). Resolve target from AO repos.json or slug; run the target's bin/tm task new; record origin {repo, task, agent}; add a cross-repo dependency on the origin task. Plugins stay independent: CLI only.