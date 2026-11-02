---
id: "TM-352"
kind: "task"
status: "done"
created: "2026-10-05T10:57:00.618Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: mailbox wait blocks on a standing-message reply (CLI + MCP orchestration_mailbox_wait)"
epic: "EP-028"
acceptance: [{"text":"ao-topology mailbox wait <id> returns the reply or times out with a non-zero exit naming the message","done":true,"at":"2026-10-05T13:14:05.766Z"},{"text":"An unknown message id is an error, not ok:true (cf TM-327)","done":true,"at":"2026-10-05T13:14:06.091Z"},{"text":"MCP orchestration_mailbox_wait exposes the same behaviour","done":true,"at":"2026-10-05T13:14:06.490Z"}]
evidence: [".bytedesk/task-management/evidence/TM-352-1791206047219.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/191","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/211","7074abce"]
blockedBy: ["TM-351"]
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T07:27:14.745Z"
priority: "high"
links: [{"type":"relates to","id":"TM-374"}]
comments: [{"author":"main","ts":"2026-10-05T12:31:31.739Z","text":"Actively in progress (2026-10-05): EP-028 lead's worker w-recv is implementing this in an isolated worktree; PR to follow. Not stale — do not park or re-dispatch."},{"author":"review-sweep","ts":"2026-10-05T15:18:26.668Z","text":"review-sweep: TM-352 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:31:44.044Z","text":"Superseded: the earlier 'actively in progress' note no longer applies — this task is done (see evidence)."},{"author":"main","ts":"2026-10-05T15:54:51.150Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/191 (independent post-merge review rv-193: all ACs met; fix TM-465)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-352-1791206047219.log":{"source":null,"sha256":"82b4b6488f244e31b684bc5232b0660cde824639e81ac8bb3e785e0e98ed5e9d","bytes":142,"at":"2026-10-05T13:14:07.219Z"}}
closed: "2026-10-05T13:14:08.011Z"
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (A2). Reuse waitForReplies (topology/lib/mailbox.mjs); move to KV watch when TM-311 lands. Replaces sleep-polling loops the harness blocks.