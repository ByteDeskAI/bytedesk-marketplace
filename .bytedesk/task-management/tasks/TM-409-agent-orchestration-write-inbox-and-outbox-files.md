---
id: "TM-409"
kind: "task"
status: "done"
created: "2026-10-05T13:45:32.484Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: write inbox and outbox files for NATS-delivered run mail"
epic: "EP-028"
acceptance: [{"text":"A file-only reviewer receives a NATS-delivered message as an inbox file","done":true,"at":"2026-10-05T15:27:40.153Z"},{"text":"The recipient is given an outbox path for its reply","done":true,"at":"2026-10-05T15:27:40.594Z"},{"text":"Test covers both","done":true,"at":"2026-10-05T15:27:41.043Z"}]
evidence: [".bytedesk/task-management/evidence/TM-409-1791214061471.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/207","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-3"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:37:56.820Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-409-1791214061471.log":{"source":null,"sha256":"b29223f89bc98211ccc28e9e64439b81b9e24d9b5276725791800f68ca279d84","bytes":368,"at":"2026-10-05T15:27:41.472Z"}}
closed: "2026-10-05T15:27:41.856Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:28:58.238Z","text":"review-sweep: TM-409 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:37:56.815Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/207 (independent post-merge review rv-216)"}]
---

Split from TM-309 (run note). File-only reviewers cannot receive NATS-only messages because inbox files are not materialized.