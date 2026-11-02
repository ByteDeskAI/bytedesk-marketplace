---
id: "TM-360"
kind: "task"
status: "done"
created: "2026-10-05T10:57:07.877Z"
board: "bytedeskai/bytedesk-marketplace"
title: "one shared duplicate-dispatch guard for the pool and the lead"
epic: "EP-028"
acceptance: [{"text":"Pool dispatch refuses a task with a live AO assignment","done":true,"at":"2026-10-05T14:14:59.439Z"},{"text":"Lead start-worker refuses a task with a live pool dispatch record","done":true,"at":"2026-10-05T14:14:59.892Z"},{"text":"Both paths call the same function (grep evidence)","done":true,"at":"2026-10-05T14:15:00.254Z"}]
evidence: [".bytedesk/task-management/evidence/TM-360-1791209700632.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/203","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-2","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/215","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/221","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/243"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T03:47:37.176Z"
priority: "high"
links: [{"type":"relates to","id":"TM-348"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-360-1791209700632.log":{"source":null,"sha256":"f22888e4257b7fb4a6cd6b3743b24f3c97f18e832f896646a4fa70db38a033eb","bytes":324,"at":"2026-10-05T14:15:00.633Z"}}
closed: "2026-10-05T14:15:01.064Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:28.397Z","text":"review-sweep: TM-360 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:34:59.204Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/203 (independent post-merge review rv-203; fixes TM-436 TM-437 TM-438)"}]
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (B5). TM-010 incident: pool started a second worker the lead did not know about. Both callers must use one implementation (verification rule 3).