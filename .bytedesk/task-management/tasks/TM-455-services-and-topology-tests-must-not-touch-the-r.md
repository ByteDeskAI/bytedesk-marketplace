---
id: "TM-455"
kind: "task"
status: "open"
created: "2026-10-05T15:41:05.264Z"
board: "bytedeskai/bytedesk-marketplace"
title: "services and topology tests must not touch the real systemd unit or leak process-compose"
epic: "EP-028"
acceptance: [{"text":"Tests isolate the unit directory (XDG_CONFIG_HOME or a test-only unit name) and never write ~/.config/systemd/user/agent-orchestration.service; test asserts the real unit is unchanged","done":false},{"text":"Tests use a free or test-only port, never 45100, and stop every process-compose they start, including on failure","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "2d38b07f-c03b-4c88-a0c4-0f0bdf7379f8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:41:05.274Z"
---

Filed from Bastion TM-027 by the Bastion lead (dc778cb2), 2026-10-05, per the keep-work-moving rule. Dedupe against existing tasks if one already covers it.

