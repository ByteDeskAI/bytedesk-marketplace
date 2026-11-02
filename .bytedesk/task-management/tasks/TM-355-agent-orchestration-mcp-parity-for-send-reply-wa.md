---
id: "TM-355"
kind: "task"
status: "done"
created: "2026-10-05T10:57:03.456Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: MCP parity for send, reply, wait, lead status and handoff; rename run follow-up tools"
epic: "EP-028"
acceptance: [{"text":"MCP tools exist for run-mail send, reply, wait, lead status and handoff","done":true,"at":"2026-10-05T14:15:01.903Z"},{"text":"orchestration_run_followup and orchestration_run_wait exist; old names remain as documented aliases","done":true,"at":"2026-10-05T14:15:02.307Z"},{"text":"Each new tool has a unit test","done":true,"at":"2026-10-05T14:15:02.713Z"}]
evidence: [".bytedesk/task-management/evidence/TM-355-1791209703132.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/201","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-2"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:53:13.083Z"
priority: "medium"
evidenceSources: {".bytedesk/task-management/evidence/TM-355-1791209703132.log":{"source":null,"sha256":"68c5403583cec457665b85b3da92b636a8b509eb530fa9d315aedaad6f714599","bytes":324,"at":"2026-10-05T14:15:03.133Z"}}
closed: "2026-10-05T14:15:03.520Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:27.266Z","text":"review-sweep: TM-355 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:53:13.078Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/201 (independent post-merge review rv-195; fixes TM-463 TM-464)"}]
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (A5). orchestration_send/orchestration_wait act on provider runs, not agent mail; rename to orchestration_run_followup/orchestration_run_wait with aliases.