---
id: "TM-334"
kind: "task"
status: "open"
created: "2026-10-04T00:58:19.044Z"
board: "bytedeskai/bytedesk-marketplace"
title: "operator: recover the live local NATS home after the EP-026 test runs migrated it (older clients refused)"
epic: "EP-026"
acceptance: [{"text":"Server log shows no authentication errors from installed clients for 10 minutes","done":false},{"text":"agent-users.json contains no leaked test users","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "177a0074-f13b-446a-92db-45e161f580ba"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-04T00:58:19.052Z"
---

During EP-026 verification, test runs that used the real home migrated ~/.bytedesk/agent-orchestration/nats to the per-agent nkey format and loaded hundreds of test users; installed 0.15.x clients now get authentication errors. Files as found are backed up. Options: upgrade all sessions to the new code (chosen by the operator, blocked on merging PR 179), restore a legacy password user with the operator's approval, or reset the home. Root cause fixed in PR 179 (tests use a private AO_NATS_HOME).