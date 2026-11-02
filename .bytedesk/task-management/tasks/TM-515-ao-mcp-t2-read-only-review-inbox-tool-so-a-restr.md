---
id: "TM-515"
kind: "task"
status: "open"
created: "2026-10-09T05:19:45.919Z"
board: "bytedeskai/bytedesk-marketplace"
title: "AO MCP T2: read-only review_inbox tool so a restricted reviewer can read its own standing mail"
epic: "EP-029"
acceptance: [{"text":"tools/list for the reviewer server returns exactly review_submit, review_inbox and review_run_checks (or review_submit and review_inbox until T3 lands)","done":false},{"text":"A reviewer sees only mail delivered to itself; another agent's mail is never shown","done":false},{"text":"The repository and board stay byte-identical after calling every tool with hostile arguments","done":false}]
evidence: []
commits: []
blockedBy: ["TM-427"]
blocks: ["TM-509"]
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T17:17:54.841Z"
priority: "high"
---

Design detail: .bytedesk/task-management/evidence/EP-autonomy/audit-mcp.md section 5 (T2). Update the affected role prompts to prefer the MCP tool and keep the CLI as a fallback. Tests must fail on an empty result. The reviewer has no Bash and its file tools cannot reach the mailbox (reviewer.mjs:224), so at least 12 messages went unread across 6 reviewers in 5 repos. Add review_inbox to topology/review-mcp.mjs (readStandingInbox as the pinned AO_AGENT_ID, no agent argument, pane-proved), and allow it next to review_submit at reviewer.mjs:223. Keep --restricted. No reply or write tool. Closes TM-509 AC1. Depends on TM-427.