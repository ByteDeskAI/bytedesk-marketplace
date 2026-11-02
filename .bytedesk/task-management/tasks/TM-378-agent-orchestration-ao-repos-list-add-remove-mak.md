---
id: "TM-378"
kind: "task"
status: "done"
created: "2026-10-05T10:57:23.665Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: ao repos list|add|remove makes repository registration explicit"
epic: "EP-028"
acceptance: [{"text":"repos list shows registered repos with supervisor state","done":true,"at":"2026-10-05T15:27:17.744Z"},{"text":"add/remove register and unregister supervisors","done":true,"at":"2026-10-05T15:27:18.184Z"}]
evidence: [".bytedesk/task-management/evidence/TM-378-1791214038615.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/208","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-3"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:37:55.164Z"
priority: "low"
evidenceSources: {".bytedesk/task-management/evidence/TM-378-1791214038615.log":{"source":null,"sha256":"f446ff6b90dcaa7037e9b277f6d99038238e5b98dcd35926b8893674e8a64a2f","bytes":368,"at":"2026-10-05T15:27:18.615Z"}}
closed: "2026-10-05T15:27:19.038Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:28:57.127Z","text":"review-sweep: TM-378 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:37:55.159Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/208 (independent post-merge review rv-216; fix TM-451, LOWs TM-452)"}]
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (E3).