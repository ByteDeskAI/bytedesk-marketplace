---
id: "TM-376"
kind: "task"
status: "done"
created: "2026-10-05T10:57:21.937Z"
board: "bytedeskai/bytedesk-marketplace"
title: "/orchestrate router skill spanning agent-orchestration and task-management"
epic: "EP-028"
acceptance: [{"text":"One skill maps intents (dispatch, ticket a repo, message a lead, launch a team, run a goal, status) to the right skill or verb","done":true,"at":"2026-10-05T15:27:11.289Z"},{"text":"Every referenced verb exists (checked by a test)","done":true,"at":"2026-10-05T15:27:11.769Z"}]
evidence: [".bytedesk/task-management/evidence/TM-376-1791214032337.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/208","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-3"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:37:54.186Z"
priority: "medium"
evidenceSources: {".bytedesk/task-management/evidence/TM-376-1791214032337.log":{"source":null,"sha256":"f446ff6b90dcaa7037e9b277f6d99038238e5b98dcd35926b8893674e8a64a2f","bytes":368,"at":"2026-10-05T15:27:12.339Z"}}
closed: "2026-10-05T15:27:12.940Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:28:56.299Z","text":"review-sweep: TM-376 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:37:54.182Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/208 (independent post-merge review rv-216; fix TM-451, LOWs TM-452)"}]
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (E1). Four ways to run work on another agent; route/cap/agent each mean three things.