---
id: "TM-138"
kind: "task"
status: "open"
created: "2026-09-09T21:32:53.018Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Presence producer: populate the header extension keys"
epic: "EP-018"
acceptance: [{"text":"collectPresenceAgents populates activity, mailboxDepth, task, roleName, slots and top-level slotQueues, and the unknown-role mapping means no agent is ever dropped from presence.","done":true,"at":"2026-09-10T03:51:50.141Z"},{"text":"The frozen validate_presence.py and test_validator.py both still pass UNCHANGED. If either needs editing, the design has leaked into the frozen contract and is wrong.","done":true,"at":"2026-09-10T03:51:50.277Z"}]
evidence: []
commits: ["4f67d94","75ee3dc","36b9308","df1af22","20e9df2"]
blockedBy: ["TM-136"]
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T05:05:59.665Z"
comments: [{"author":"main","ts":"2026-09-09T21:52:04.995Z","text":"See the routed finding on TM-136 for the exact shape of the collectPresenceAgents drop this task must fix: the ROLES filter at presence.mjs:160 applies to run agents only, not standing sessions, so the unknown-role mapping needs to happen in the run-agent branch. Verified in the tree by the integrator, not inferred."}]
---

Producer-side implementation of the additive keys, blocked on the countersignature. slotQueues from slots.mjs, mailboxDepth from queueDepth, activity from the census, task from the management record's assignee, roleName plus the unknown-role mapping fix.