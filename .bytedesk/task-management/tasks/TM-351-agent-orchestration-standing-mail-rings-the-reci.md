---
id: "TM-351"
kind: "task"
status: "done"
created: "2026-10-05T10:56:59.782Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: standing mail rings the recipient pane on arrival so agents stop polling the inbox"
epic: "EP-028"
acceptance: [{"text":"Accepted standing mail for an agent rings its pane through ringMessage, held when the composer is unsafe","done":true,"at":"2026-10-05T13:14:04.723Z"},{"text":"A test proves a message reaches an idle recipient with no inbox call","done":true,"at":"2026-10-05T13:14:05.075Z"},{"text":"A held ring is retried by the supervisor and never types into a non-empty composer","done":true,"at":"2026-10-05T13:14:05.400Z"}]
evidence: [".bytedesk/task-management/evidence/TM-351-1791206046873.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/191","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/211"]
blockedBy: []
blocks: ["TM-352"]
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:54:50.730Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T12:31:31.357Z","text":"Actively in progress (2026-10-05): EP-028 lead's worker w-recv is implementing this in an isolated worktree; PR to follow. Not stale — do not park or re-dispatch."},{"author":"review-sweep","ts":"2026-10-05T15:18:26.367Z","text":"review-sweep: TM-351 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:31:43.597Z","text":"Superseded: the earlier 'actively in progress' note no longer applies — this task is done (see evidence)."},{"author":"main","ts":"2026-10-05T15:54:50.724Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/191 (independent post-merge review rv-193: all ACs met; fix TM-465)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-351-1791206046873.log":{"source":null,"sha256":"4384fb4bea65fabfdf3802c73ebb09a64b9c5e2bcd2800d4f8d67029e150e392","bytes":230,"at":"2026-10-05T13:14:06.873Z"}}
closed: "2026-10-05T13:14:07.533Z"
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (A1). Supervisor reuses ringMessage (topology/lib/delivery.mjs) when it accepts standing mail. Transcripts: 298 manual 'mailbox inbox' calls.