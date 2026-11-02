---
id: "TM-454"
kind: "task"
status: "open"
created: "2026-10-05T15:41:03.969Z"
board: "bytedeskai/bytedesk-marketplace"
title: "newly launched leads stop at Claude Code's workspace-trust prompt for their agent folder"
epic: "EP-028"
acceptance: [{"text":"a new lead on a fresh repo starts without an unexpected trust prompt, via a method the operator approved","done":false},{"text":"doctor/ensure reports a lead stuck at a trust prompt with the exact action to take","done":false}]
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
updated: "2026-10-05T15:41:03.979Z"
---

Filed from Bastion TM-013 by the Bastion lead (dc778cb2), 2026-10-05, per the keep-work-moving rule. Dedupe against existing tasks if one already covers it.


Delivers into ByteDeskAI/bytedesk-marketplace. Observed 2026-10-02 when starting the Bastion lead: mass-laptop01--bastion--lead--anwen sat at 'Is this a project you created or one you trust?' for .bytedesk/agent-orchestration/agents/<id>, so lead ensure failed with TOPOLOGY_SESSION_START ('Provider is not accepting startup instructions'). Every new machine/repo will hit this. Decide the safe fix (e.g. launch in the repo root that the operator already trusts — overlaps marketplace TM-242 'standing panes start in the agent dir' — or pre-register trust only with the operator's explicit consent) and fold it into the automatic setup; never auto-accept trust silently.