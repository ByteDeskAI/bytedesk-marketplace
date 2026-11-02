---
id: "TM-372"
kind: "task"
status: "done"
created: "2026-10-05T10:57:18.435Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: @all-leads broadcast audience for standing mail"
epic: "EP-028"
acceptance: [{"text":"mailbox send --to @all-leads fans out to every registered repo lead","done":true,"at":"2026-10-05T13:15:37.472Z"},{"text":"Fan-out honours the existing 24-recipient cap and loop guard","done":true,"at":"2026-10-05T13:15:37.811Z"}]
evidence: [".bytedesk/task-management/evidence/TM-372-1791206138146.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/195"]
blockedBy: ["TM-353"]
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:53:12.672Z"
priority: "medium"
comments: [{"author":"main","ts":"2026-10-05T12:31:30.978Z","text":"Actively in progress (2026-10-05): EP-028 lead's worker w-send is implementing this in an isolated worktree; PR to follow. Not stale — do not park or re-dispatch."},{"author":"review-sweep","ts":"2026-10-05T15:18:31.118Z","text":"review-sweep: TM-372 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:31:43.162Z","text":"Superseded: the earlier 'actively in progress' note no longer applies — this task is done (see evidence)."},{"author":"main","ts":"2026-10-05T15:53:12.666Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/195 (independent post-merge review rv-195; fixes TM-462 TM-464)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-372-1791206138146.log":{"source":null,"sha256":"2fbe8424edb47da7237aa7a997b442cd396c554f45dc99577a4a7879b947c62a","bytes":233,"at":"2026-10-05T13:15:38.147Z"}}
closed: "2026-10-05T13:15:38.495Z"
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (F0c).