---
id: "TM-356"
kind: "task"
status: "done"
created: "2026-10-05T10:57:04.367Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: mailbox send and MCP mailbox tools derive the sender from session identity"
epic: "EP-028"
acceptance: [{"text":"A caller cannot send as another agent via --from or the MCP from field","done":true,"at":"2026-10-05T13:15:35.551Z"},{"text":"mailbox receive/dispose via MCP require the caller's own identity","done":true,"at":"2026-10-05T13:15:35.887Z"},{"text":"Tests prove spoofing is refused","done":true,"at":"2026-10-05T13:15:36.221Z"}]
evidence: [".bytedesk/task-management/evidence/TM-356-1791206136564.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/195","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/220"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:53:12.224Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T12:31:30.604Z","text":"Actively in progress (2026-10-05): EP-028 lead's worker w-send is implementing this in an isolated worktree; PR to follow. Not stale — do not park or re-dispatch."},{"author":"review-sweep","ts":"2026-10-05T15:18:27.520Z","text":"review-sweep: TM-356 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:31:42.677Z","text":"Superseded: the earlier 'actively in progress' note no longer applies — this task is done (see evidence)."},{"author":"main","ts":"2026-10-05T15:53:12.219Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/195 (independent post-merge review rv-195; fixes TM-462 TM-464)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-356-1791206136564.log":{"source":null,"sha256":"2fbe8424edb47da7237aa7a997b442cd396c554f45dc99577a4a7879b947c62a","bytes":233,"at":"2026-10-05T13:15:36.565Z"}}
closed: "2026-10-05T13:15:36.890Z"
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (A6). Today 'from' is caller-asserted (cli.mjs mailbox send --from / AO_AGENT_ID; MCP from field).