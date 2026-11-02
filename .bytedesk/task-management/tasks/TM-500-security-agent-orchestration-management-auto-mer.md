---
id: "TM-500"
kind: "task"
status: "open"
created: "2026-10-09T02:17:42.130Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY agent-orchestration: management.auto_merge resolves from worker-writable config layers"
epic: "EP-028"
acceptance: [{"text":"management.auto_merge is a protected key read only through loadGovernedConfig; a local value is ignored with a config_warnings entry","done":false},{"text":"Test: a worker-written global or repo-file auto_merge is ignored","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T02:17:42.698Z"
priority: "high"
---

Found during TM-469 (PR #241). integrate_via and target_branch are now protected keys read from the server default branch via loadGovernedConfig, but management.auto_merge still resolves from the repo file and the global layer, which a same-UID worker can write. Impact today is operator-shell flows only; same class of hole.