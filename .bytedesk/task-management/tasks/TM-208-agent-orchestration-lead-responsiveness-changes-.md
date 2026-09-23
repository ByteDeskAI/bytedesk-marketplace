---
id: "TM-208"
kind: "task"
status: "open"
created: "2026-09-23T22:21:27.578Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: lead responsiveness changes leave no durable record, so flapping is invisible after the fact"
epic: "EP-019"
acceptance: [{"text":"A change from responsive to unresponsive, or back, appends exactly one role-history entry; repeated identical observations append none.","done":false},{"text":"'ao-topology role history lead' shows from, to, at and the observing source for each change.","done":false},{"text":"A unit test drives the change through fake probes and fails if the append is removed.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-09-23T22:21:43.710Z"
---

Observer b3004241 reported on 2026-09-17 that 'ao-topology role history lead' is empty while the gateway lead flapped between responsive and unresponsive. Still true on 2026-09-23 (verified: role history lead returns entries: []). History is appended only by the assign, ensure, detach and reassign verbs (topology/lib/roles.mjs:84-89, 273, 291, 322, 401). lead-recovery.mjs:124-127 overwrites one recovery.json, and its journal records only lead.dead_external (lead-recovery.mjs:153). An operator cannot tell afterwards that readiness changed, which is why this pattern was found only by live sampling.