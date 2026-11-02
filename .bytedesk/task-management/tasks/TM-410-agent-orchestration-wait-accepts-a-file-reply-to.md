---
id: "TM-410"
kind: "task"
status: "done"
created: "2026-10-05T13:45:33.139Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: wait accepts a file reply to a NATS-delivered message"
epic: "EP-028"
acceptance: [{"text":"pendingReplies and waitForReplies treat a message with an outbox reply file as answered","done":true,"at":"2026-10-05T15:27:42.702Z"},{"text":"Test covers it","done":true,"at":"2026-10-05T15:27:43.156Z"}]
evidence: [".bytedesk/task-management/evidence/TM-410-1791214063502.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/207","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-3"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:37:57.177Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-410-1791214063502.log":{"source":null,"sha256":"b29223f89bc98211ccc28e9e64439b81b9e24d9b5276725791800f68ca279d84","bytes":368,"at":"2026-10-05T15:27:43.503Z"}}
closed: "2026-10-05T15:27:43.869Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:28:58.566Z","text":"review-sweep: TM-410 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:37:57.173Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/207 (independent post-merge review rv-216)"}]
---

Split from TM-309 (run note). wait counts a file reply as pending.