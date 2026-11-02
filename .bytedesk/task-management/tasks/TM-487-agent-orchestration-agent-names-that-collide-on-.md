---
id: "TM-487"
kind: "task"
status: "done"
created: "2026-10-08T23:25:51.404Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: agent names that collide on the NATS subject (a.b vs a_b) dead-letter each other's mail"
epic: "EP-028"
acceptance: [{"text":"Agent ids that sanitise to the same subject are refused at registration, or the subject encoding is injective (test)","done":true,"at":"2026-10-09T04:49:42.346Z"}]
evidence: [".bytedesk/task-management/evidence/TM-487-1791521382841.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/236"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T04:49:43.752Z"
comments: [{"author":"main","ts":"2026-10-09T02:13:31.775Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/236 @ de307b4e (independent review + delta rv-236)"},{"author":"main","ts":"2026-10-09T02:13:32.764Z","text":"rv-236 follow-up (LOW): launch checks run members only against each other; also add registered standing agent ids to subjectTakenBy's list in launchClaimed."},{"author":"main","ts":"2026-10-09T04:49:43.280Z","text":"review verdict: approved — independent subagent reviewer approved PR #236 https://github.com/ByteDeskAI/bytedesk-marketplace/pull/236 (verdict delivered to the lead session)."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-487-1791521382841.log":{"source":null,"sha256":"e5cade638f7159f17a30b616c0ea83bee02133c4af73b1c7e3da9c82b122d1b9","bytes":98,"at":"2026-10-09T04:49:42.842Z"}}
closed: "2026-10-09T04:49:43.743Z"
---

Found by the TM-482 worker (PR #229): agent ids a.b and a_b map to the same NATS subject token; after TM-482, the other agent's message is dead-lettered instead of blocking the inbox, so it is not delivered.