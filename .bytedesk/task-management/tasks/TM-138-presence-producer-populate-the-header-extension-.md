---
id: "TM-138"
kind: "task"
status: "blocked"
created: "2026-09-09T21:32:53.018Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Presence producer: populate the header extension keys"
epic: "EP-018"
acceptance: [{"text":"collectPresenceAgents populates activity, mailboxDepth, task, roleName, slots and top-level slotQueues, and the unknown-role mapping means no agent is ever dropped from presence.","done":true,"at":"2026-09-10T03:51:50.141Z"},{"text":"The frozen validate_presence.py and test_validator.py both still pass UNCHANGED. If either needs editing, the design has leaked into the frozen contract and is wrong.","done":true,"at":"2026-09-10T03:51:50.277Z"}]
evidence: []
commits: ["4f67d94","75ee3dc","36b9308","df1af22"]
blockedBy: ["TM-136"]
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T03:51:50.400Z"
comments: [{"author":"main","ts":"2026-09-09T21:52:04.995Z","text":"See the routed finding on TM-136 for the exact shape of the collectPresenceAgents drop this task must fix: the ROLES filter at presence.mjs:160 applies to run agents only, not standing sessions, so the unknown-role mapping needs to happen in the run-agent branch. Verified in the tree by the integrator, not inferred."}]
blockedReason: "Code complete and gated; blocked on the integrator's merge only. Branch tm/TM-138-producer, STACKED on tm/TM-136-d1-observedat (take that first), commit e57d0d9. collectPresenceAgents now emits activity, mailboxDepth, task, roleName, per-agent slots and a top-level slotQueues, each from the source that already computes it — the census, queueDepth, the management record's assignee, slotStatus — because a second computation would be a second source of truth. The unknown-role mapping AC1 names was already landed by TM-136 and is unchanged. EACH SOURCE FAILS INDEPENDENTLY AND SILENTLY, deliberately: presence is a heartbeat whose ABSENCE is the signal, so a missing or truncated census costs its own key and never the publish; tested with a truncated document because that is what a crash mid-publish leaves. A STALE census renders activity.state as unknown rather than the last confident verdict — TM-131's rule reaching the wire. Section 5 holds at the boundary: the census's reason and evidence never cross, queueDepth's messages array is dropped (stage slugs), and the slot record's operator-prose reason is dropped. slotQueues is lifted onto the envelope explicitly because JSON.stringify silently drops an array property. AC2 met exactly as written: the FROZEN validate_presence.py and test_validator.py both pass UNCHANGED, the frozen fixture directory is untouched, and a produced snapshot carrying every new key is validated by the frozen validator inside the test. Gates: topology 362/362."
---

Producer-side implementation of the additive keys, blocked on the countersignature. slotQueues from slots.mjs, mailboxDepth from queueDepth, activity from the census, task from the management record's assignee, roleName plus the unknown-role mapping fix.