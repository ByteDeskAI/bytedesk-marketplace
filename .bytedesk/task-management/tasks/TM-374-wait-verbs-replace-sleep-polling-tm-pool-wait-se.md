---
id: "TM-374"
kind: "task"
status: "done"
created: "2026-10-05T10:57:20.186Z"
board: "bytedeskai/bytedesk-marketplace"
title: "wait verbs replace sleep-polling: tm pool wait, services wait"
epic: "EP-028"
acceptance: [{"text":"tm pool wait and agent-orchestration services wait block until a stated condition or timeout","done":true,"at":"2026-10-05T14:14:53.004Z"},{"text":"Skills and prompts use them instead of sleep loops","done":true,"at":"2026-10-05T14:14:53.397Z"}]
evidence: [".bytedesk/task-management/evidence/TM-374-1791209693759.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/200","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-2","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/221"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:37:05.578Z"
priority: "medium"
links: [{"type":"relates to","id":"TM-352"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-374-1791209693759.log":{"source":null,"sha256":"cbaaa2e5b2831b56de4e8b9ddccdc633165cd19cf95981edeccdde2527b237d9","bytes":324,"at":"2026-10-05T14:14:53.760Z"}}
closed: "2026-10-05T14:14:54.142Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:31.558Z","text":"review-sweep: TM-374 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:37:05.574Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/200 (independent post-merge review rv-197; fixes TM-448 TM-449 TM-450)"}]
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (F2). 78+ 'Blocked: sleep N' errors in gateway transcripts.