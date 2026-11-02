---
id: "TM-371"
kind: "task"
status: "done"
created: "2026-10-05T10:57:17.564Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent identity is visible: name and role in status line and tab title; readable repo slug in NATS subjects"
epic: "EP-028"
acceptance: [{"text":"Status line/tab title show agent name and role","done":true,"at":"2026-10-05T14:15:04.410Z"},{"text":"Subjects or headers carry a human-readable repo slug","done":true,"at":"2026-10-05T14:15:04.877Z"}]
evidence: [".bytedesk/task-management/evidence/TM-371-1791209705344.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/201","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-2"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:53:13.460Z"
priority: "medium"
evidenceSources: {".bytedesk/task-management/evidence/TM-371-1791209705344.log":{"source":null,"sha256":"68c5403583cec457665b85b3da92b636a8b509eb530fa9d315aedaad6f714599","bytes":324,"at":"2026-10-05T14:15:05.345Z"}}
closed: "2026-10-05T14:15:05.781Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:30.913Z","text":"review-sweep: TM-371 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:53:13.455Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/201 (independent post-merge review rv-195; fixes TM-463 TM-464)"}]
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (F0b). Users ask 'who is the lead in this repo?'; subjects are orch.<sha16>.