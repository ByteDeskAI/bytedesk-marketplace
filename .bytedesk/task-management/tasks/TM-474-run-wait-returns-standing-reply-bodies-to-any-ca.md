---
id: "TM-474"
kind: "task"
status: "done"
created: "2026-10-05T17:56:49.801Z"
board: "bytedeskai/bytedesk-marketplace"
title: "run wait returns standing reply bodies to any caller who knows a runDir"
epic: "EP-028"
acceptance: [{"text":"obligations sets replyBody only for the standing envelope's sender, or run wait is bound to the run conductor (test)","done":true,"at":"2026-10-09T04:49:35.078Z"},{"text":"The audit regex catches the readStandingMessage)( shape and the two internal sites are allowlisted explicitly","done":true,"at":"2026-10-09T04:49:35.522Z"},{"text":"The allowlist comment is corrected","done":true,"at":"2026-10-09T04:49:36.001Z"}]
evidence: [".bytedesk/task-management/evidence/TM-474-1791521376517.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/236"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T04:49:37.425Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-09T02:13:30.951Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/236 @ de307b4e (independent review + delta rv-236)"},{"author":"main","ts":"2026-10-09T04:49:36.934Z","text":"review verdict: approved — independent subagent reviewer approved PR #236 https://github.com/ByteDeskAI/bytedesk-marketplace/pull/236 (verdict delivered to the lead session)."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-474-1791521376517.log":{"source":null,"sha256":"e5cade638f7159f17a30b616c0ea83bee02133c4af73b1c7e3da9c82b122d1b9","bytes":98,"at":"2026-10-09T04:49:36.518Z"}}
closed: "2026-10-09T04:49:37.415Z"
---

rv-225 final on #225: mailbox.mjs obligations sets replyBody: record.reply.body (~523) and waitForReplies returns it (~665) via CLI 'ao-topology wait --run <dir>' and MCP orchestration_run_mail_wait (unbound, audit-exempt). Bypasses TM-465 for run-originated standing mail. Also: the audit regex misses '(options.readMessage ?? readStandingMessage)(' call shapes (goal-loop.mjs:449/463, management.mjs:1264), and the readStandingMessage allowlist comment wrongly says obligations never returns a body.