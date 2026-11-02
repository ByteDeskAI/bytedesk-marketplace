---
id: "TM-368"
kind: "task"
status: "done"
created: "2026-10-05T10:57:14.928Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: autonomy policy pr|merge|publish drives the lead landing path through release"
epic: "EP-028"
acceptance: [{"text":"autonomy setting per repo, default pr; publish runs release after merge and verifies the artifact","done":true,"at":"2026-10-05T15:27:08.275Z"},{"text":"Red TeamCity build, failed postflight or missing reviewer approval stops and pages via ntfy","done":true,"at":"2026-10-05T15:27:08.784Z"},{"text":"Origin sender is notified on publish","done":true,"at":"2026-10-05T15:27:09.313Z"}]
evidence: [".bytedesk/task-management/evidence/TM-368-1791214029879.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/213","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-3"]
blockedBy: ["TM-250"]
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:50:22.686Z"
priority: "highest"
evidenceSources: {".bytedesk/task-management/evidence/TM-368-1791214029879.log":{"source":null,"sha256":"88b70c8e3abe611c217f1e18f94f8562a3aa466e61245d3143e5685c25ae48f0","bytes":368,"at":"2026-10-05T15:27:09.881Z"}}
closed: "2026-10-05T15:27:10.328Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:28:55.962Z","text":"review-sweep: TM-368 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:35:41.005Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/213 (security review w-secreview: TM-442)"},{"author":"main","ts":"2026-10-05T15:50:22.681Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/213 (independent post-merge review rv-gov: fixes TM-457 TM-458, TM-442)"}]
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (D1, D2). Ryan 2026-10-05: fully autonomous through publishing. Reuse repo /release + TeamCity; EP-024 TM-250/251/253.