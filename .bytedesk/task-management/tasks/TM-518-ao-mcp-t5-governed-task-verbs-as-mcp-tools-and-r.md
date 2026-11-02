---
id: "TM-518"
kind: "task"
status: "blocked"
created: "2026-10-09T05:19:49.116Z"
board: "bytedeskai/bytedesk-marketplace"
title: "AO MCP T5: governed-task verbs as MCP tools, and rework allowed from a blocked verdict (TM-509 deadlocks)"
epic: "EP-029"
acceptance: [{"text":"A worker calling rework is refused on both the CLI and MCP paths","done":false},{"text":"A lead calling rework on a task with a blocked review returns it to working, and a collected-failed task with no submitted revision gets a clean refusal naming manage admit","done":false},{"text":"A report through MCP produces a record identical to the CLI's","done":false}]
evidence: []
commits: []
blockedBy: ["TM-514"]
blocks: ["TM-509"]
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-10T07:56:36.617Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-09T05:24:46.131Z","text":"Another raw-exception shape (2026-10-09): when 'tm start' refuses inside 'manage admit' (here: WIP limit 12 reached), admit dies with an uncaught Node 'Command failed' stack and the real reason is buried in stderr. All manage verbs that shell out to tm should surface tm's refusal as a TOPOLOGY_* error with its text."}]
links: [{"type":"relates to","id":"TM-531"}]
---

Design detail: .bytedesk/task-management/evidence/EP-autonomy/audit-mcp.md section 5 (T5). Update the affected role prompts to prefer the MCP tool and keep the CLI as a fallback. Tests must fail on an empty result. Add orchestration_manage_report (workers, own task only), orchestration_manage_rework and orchestration_manage_retry_review (lead, requireLeadCaller), and orchestration_manage_status (read-only). Move the worker allowlist from cli.mjs:898 into management.mjs so both paths share it. Rework must also accept a blocked review, and a collected-failed task with no submitted revision must refuse with a TOPOLOGY_* error naming the recovery verb, not an uncaught exception. Closes TM-509 AC2. Depends on T1.