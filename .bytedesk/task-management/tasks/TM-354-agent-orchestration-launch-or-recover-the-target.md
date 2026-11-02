---
id: "TM-354"
kind: "task"
status: "done"
created: "2026-10-05T10:57:02.565Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: launch or recover the target repo lead when mail is held leads_not_ready or no_lead"
epic: "EP-028"
acceptance: [{"text":"A held leads_not_ready or no_lead message triggers the target supervisor to launch or recover the lead","done":true,"at":"2026-10-05T13:16:57.580Z"},{"text":"The held message is delivered once the lead is proven ready","done":true,"at":"2026-10-05T13:16:57.963Z"},{"text":"Repeated triggers do not launch two leads","done":true,"at":"2026-10-05T13:16:58.324Z"}]
evidence: [".bytedesk/task-management/evidence/TM-354-1791206218684.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/193"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:54:50.357Z"
priority: "high"
evidenceSources: {".bytedesk/task-management/evidence/TM-354-1791206218684.log":{"source":null,"sha256":"132496feba4aab4462a78ad785871d20c5cc93b00263a6b7174923e5acefd234","bytes":266,"at":"2026-10-05T13:16:58.684Z"}}
closed: "2026-10-05T13:16:59.087Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:27.057Z","text":"review-sweep: TM-354 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:54:50.352Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/193 (independent post-merge review rv-193: all ACs met; test isolation TM-464, MCP identity TM-466, forgeability noted on TM-427)"}]
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (A4). Ryan 09-30: spawn a lead when a message is sent to a lead that is not available.