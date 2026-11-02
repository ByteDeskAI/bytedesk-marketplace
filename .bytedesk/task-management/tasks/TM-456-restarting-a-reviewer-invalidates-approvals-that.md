---
id: "TM-456"
kind: "task"
status: "open"
created: "2026-10-05T15:41:06.609Z"
board: "bytedeskai/bytedesk-marketplace"
title: "restarting a reviewer invalidates approvals that are not yet landed"
epic: "EP-028"
acceptance: [{"text":"restarting a reviewer cannot silently invalidate approved-but-not-landed tasks; test","done":false}]
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
updated: "2026-10-05T15:41:06.616Z"
---

Filed from Bastion TM-029 by the Bastion lead (dc778cb2), 2026-10-05, per the keep-work-moving rule. Dedupe against existing tasks if one already covers it.


Found 2026-10-03 (see TM-028 comment 3): after agent restart of faro (new reviewer incarnation), the governed-completion gate rejected the existing approvals for TM-302..305 (approved, merged, awaiting landing), forcing eight re-reviews. Fix: agent restart on a reviewer refuses or warns (naming the tasks) while its approvals await landing, or the gate accepts a prior incarnation of the same reviewer identity for an unchanged revision. Also: branch protection is the backstop for TM-325's residual risk (bytedesk-marketplace main is unprotected).