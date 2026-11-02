---
id: "TM-471"
kind: "task"
status: "done"
created: "2026-10-05T17:20:32.206Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: topology-reviewer.test.mjs tests 12 and 13 fail on main"
epic: "EP-028"
acceptance: [{"text":"Tests 12 and 13 pass on main in a clean isolated worktree","done":true,"at":"2026-10-09T01:12:31.473Z"},{"text":"Root cause recorded (code regression vs environment)","done":true,"at":"2026-10-09T01:12:31.878Z"}]
evidence: [".bytedesk/task-management/evidence/TM-471-1791508352242.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/231","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/release/agent-orchestration-0.16.1","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/tm/TM-427-security-agent-orchestration-reviewer-any-proces"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T01:31:58.320Z"
comments: [{"author":"main","ts":"2026-10-08T23:48:20.947Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/231 (independent review rv-230: test-only; 45/45 without preload)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-471-1791508352242.log":{"source":null,"sha256":"16f6dd3570e1288f49285348b80bc1bdf7f3cbbde7d31a2c8b450979c899d6a1","bytes":217,"at":"2026-10-09T01:12:32.243Z"}}
closed: "2026-10-09T01:12:32.609Z"
---

rv-222 while reviewing #226: tests/unit/topology-reviewer.test.mjs fails tests 12 and 13 on origin/main base as well as on the PR, so it is pre-existing. CI's unit-build-contracts passed on #216, so check whether CI runs this file under different env, or whether a later merge broke it.