---
id: "TM-519"
kind: "task"
status: "blocked"
created: "2026-10-09T05:19:50.298Z"
board: "bytedeskai/bytedesk-marketplace"
title: "AO MCP T6: dispatched workers load only the ao and tm MCP servers, with worker tool profiles on both (merge with TM-502)"
epic: "EP-029"
acceptance: [{"text":"A dispatched worker has only ao and tm MCP children; infisical, kubernetes and teamcity are absent (live ps check)","done":false},{"text":"Denied tools (tm_dispatch, claim/worktree steal, orchestration_spawn/cleanup/cancel/decision_approve, goal_*, session_handoff) are absent from tools/list","done":false}]
evidence: []
commits: []
blockedBy: ["TM-514"]
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T08:38:53.330Z"
priority: "medium"
comments: [{"author":"main","ts":"2026-10-09T08:38:53.320Z","text":"Worker-guard over-refusals seen by the TM-525 worker (2026-10-09), to cover when the worker profile lands: (1) the TM-481 guard refuses a gh pr create whose --title contains a semicolon; (2) it refuses ANY shell line whose text mentions the GitHub CLI, including inside a mailbox --body string. Both block legitimate worker reporting. The guard should parse argv and treat quoted data arguments as data (see TM-521's tm block and comment allowance), not scan raw text."}]
---

Design detail: .bytedesk/task-management/evidence/EP-autonomy/audit-mcp.md section 5 (T6). Update the affected role prompts to prefer the MCP tool and keep the CLI as a fallback. Tests must fail on an empty result. Today tmux-backend workers load every user MCP server (infisical, kubernetes and others), and the Bash-only worker guard never sees MCP calls. Launch with --setting-sources user --strict-mcp-config --mcp-config <ao+tm, profile=worker>; add WORKER_TOOLS (tm) and AO_MCP_PROFILE=worker allowlists. Depends on T1.