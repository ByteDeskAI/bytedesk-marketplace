---
id: "TM-499"
kind: "task"
status: "open"
created: "2026-10-09T02:11:20.009Z"
board: "bytedeskai/bytedesk-marketplace"
title: "AO finishCheckEvidence throws on a structured check without revision; AO accepts a missing command that tm refuses"
epic: "EP-028"
acceptance: [{"text":"Both validators agree on every row of the conformance table","done":false},{"text":"finishCheckEvidence never throws on input tm accepts","done":false}]
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
updated: "2026-10-09T02:11:39.774Z"
comments: [{"author":"main","ts":"2026-10-09T02:11:39.765Z","text":"Assigned into the TM-427 governed cluster worker (reviewer.mjs), 2026-10-09; update TM-493's conformance expectations in the same PR."}]
---

TM-493 conformance test (PR #239) pins six divergences between tm finishChecksRefusal and AO normalizeChecks/finishCheckEvidence. The material one: a structured check with no revision passes tm review-ready but makes AO finishCheckEvidence throw; AO also accepts a missing/empty command that tm refuses. Fix is in reviewer.mjs (TM-427 cluster owner).