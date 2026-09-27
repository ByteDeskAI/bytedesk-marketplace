---
id: "TM-230"
kind: "task"
status: "blocked"
created: "2026-09-24T21:08:03.367Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: journal message model for the live channel and graph views"
epic: "EP-021"
acceptance: [{"text":"Journal emits normalized post, handoff, verdict, stage and decision events with from/to and stable ids; unit tests","done":false},{"text":"Contract documented; existing journal consumers keep working","done":false}]
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
updated: "2026-09-24T22:26:41.584Z"
comments: [{"author":"main","ts":"2026-09-24T22:26:40.935Z","text":"Gateway link (from gateway lead d60f0608, 2026-09-24): serves gateway TM-447 (EP-027 P3, parked by Ryan)."}]
blockedReason: "Serves a gateway EP-027 phase Ryan parked (relayed by gateway lead d60f0608 on 2026-09-24). Held here so the pool does not dispatch it. Unblock when Ryan un-parks that phase."
---

For gateway EP-027 P3 (TM-447): the Channel and Graph views merge ACP AG-UI, native messages and feed items with from/to. Make the native journal emit one normalized event shape for agent posts, handoffs (from, to, task, artifact), review verdicts, stage transitions and human decisions, with stable ids and timestamps for replay. Document the contract for the gateway reader.