---
id: "TM-453"
kind: "task"
status: "open"
created: "2026-10-05T15:41:02.681Z"
board: "bytedeskai/bytedesk-marketplace"
title: "the (copy) repo's lead recovery fails every 10 minutes with TOPOLOGY_SESSION_OWNERSHIP"
epic: "EP-028"
acceptance: [{"text":"root cause found and filed as a marketplace task (predates TM-274 or not, with evidence)","done":false},{"text":"fix delivered so recovery stops failing for a live legacy lead","done":false}]
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
updated: "2026-10-05T15:41:02.689Z"
---

Filed from Bastion TM-009 by the Bastion lead (dc778cb2), 2026-10-05, per the keep-work-moving rule. Dedupe against existing tasks if one already covers it.


Delivers into ByteDeskAI/bytedesk-marketplace (task store ~/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management). Observed 2026-10-02: lead status for the bytedesk-marketplace (copy) checkout shows recovery action 'failed', 148 attempts, last_error 'TOPOLOGY_SESSION_OWNERSHIP: Recorded session incarnation is absent or replaced; refusing reattachment', while the legacy lead session ao-fd2b831f is alive. Find whether this predates TM-274 (session naming) or is caused by it (legacy reattach path), file a marketplace task with the root cause, and fix through ao.