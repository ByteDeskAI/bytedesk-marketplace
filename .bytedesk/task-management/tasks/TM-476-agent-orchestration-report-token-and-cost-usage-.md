---
id: "TM-476"
kind: "task"
status: "open"
created: "2026-10-05T18:28:21.226Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: report token and cost usage for spawned runs"
epic: "EP-028"
acceptance: [{"text":"orchestration_status and run events include cumulative tokens and cost per run for claude and codex adapters","done":false},{"text":"orchestration_spawn accepts maxTokens/maxCostUSD and stops the run with a clear reason when exceeded","done":false},{"text":"Documented in the MCP tool descriptions","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "daa70b0a-77c3-4cb3-ac4b-cf212a3b1cc1"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T18:28:21.235Z"
---

Requested by bytedesk-remote-gateway TM-549 (scheduled agent jobs, EP-034). The gateway runs orchestrated agent jobs through orchestration_spawn and follows them with run_wait/events, but agent-orchestration reports no token or cost usage, so per-job budgets (maxTokens, maxCostUSD) cannot be enforced for orchestrated runs; only the timeout applies. Expose cumulative input/output tokens and cost per run (from the provider adapters' usage events) in run status/events, and allow a caller-supplied budget that stops the run when exceeded.