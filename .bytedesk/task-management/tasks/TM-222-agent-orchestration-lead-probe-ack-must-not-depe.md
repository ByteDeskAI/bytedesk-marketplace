---
id: "TM-222"
kind: "task"
status: "done"
created: "2026-09-24T20:42:35.463Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: lead probe ack must not depend on the lead's model turn"
epic: "EP-028"
acceptance: [{"text":"A lead mid-turn is reported alive/busy, not unresponsive, when its process and pane binding are verified","done":true,"at":"2026-10-05T13:16:55.737Z"},{"text":"A dead or unbound lead is still detected; unit tests for both","done":true,"at":"2026-10-05T13:16:56.133Z"}]
evidence: [".bytedesk/task-management/evidence/TM-222-1791206216510.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/193","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/207"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:54:49.901Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-222-1791206216510.log":{"source":null,"sha256":"132496feba4aab4462a78ad785871d20c5cc93b00263a6b7174923e5acefd234","bytes":266,"at":"2026-10-05T13:16:56.511Z"}}
closed: "2026-10-05T13:16:56.889Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:08.659Z","text":"review-sweep: TM-222 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"review-sweep","ts":"2026-10-05T15:18:22.818Z","text":"review-sweep: TM-222 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:54:49.895Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/193 (independent post-merge review rv-193: all ACs met; test isolation TM-464, MCP identity TM-466, forgeability noted on TM-427)"}]
---

2026-09-24: the gateway reviewer tab showed the lead (d60f0608) as not responding. AO_PROBE messages arrive as text in the lead's terminal and are acked only when the model reads them between turns. During long turns (background review polling, merges) the 30s ack window lapses, so a working lead reads as unresponsive; the observer measured the same on 2026-09-17 ('lead unresponsive = missed 30s probe-ack'). Fix direction: answer liveness probes from the host side (a Claude Code hook or the supervisor verifying the lead process and pane are alive and bound), and reserve model-level acks for prompts that need comprehension.