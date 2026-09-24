---
id: "TM-222"
kind: "task"
status: "open"
created: "2026-09-24T20:42:35.463Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: lead probe ack must not depend on the lead's model turn"
epic: "EP-021"
acceptance: [{"text":"A lead mid-turn is reported alive/busy, not unresponsive, when its process and pane binding are verified","done":false},{"text":"A dead or unbound lead is still detected; unit tests for both","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "1b07de2e-6b73-47c6-ad14-aa29eeea67fd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-24T20:42:35.471Z"
---

2026-09-24: the gateway reviewer tab showed the lead (d60f0608) as not responding. AO_PROBE messages arrive as text in the lead's terminal and are acked only when the model reads them between turns. During long turns (background review polling, merges) the 30s ack window lapses, so a working lead reads as unresponsive; the observer measured the same on 2026-09-17 ('lead unresponsive = missed 30s probe-ack'). Fix direction: answer liveness probes from the host side (a Claude Code hook or the supervisor verifying the lead process and pane are alive and bound), and reserve model-level acks for prompts that need comprehension.