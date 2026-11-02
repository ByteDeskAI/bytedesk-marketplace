---
id: "TM-403"
kind: "task"
status: "open"
created: "2026-10-05T13:23:52.819Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: cross-repo task:<TM-id> mail may never reach a tm-dispatched worker (claim actor is the lead's session, not worker.name)"
epic: "EP-028"
acceptance: [{"text":"A test using a real tm dispatch record (not a hand-written assignee) delivers delegated cross-repo task:<id> mail to the worker","done":false},{"text":"Without a delegation it still routes to the lead","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T13:23:52.829Z"
---

From the PR #196 (TM-384) review, 2026-10-05: routing.mjs:268 calls delegationAllows without 'agent', and verifyAgainstStore requires the store's claim actor or assignee to equal worker.name (codex-..., adopted:TM-n). A tm-dispatched task is claimed under the lead's TM_SESSION_ID (TM-218), so cross-repo task:<id> mail probably always falls back to the lead. That fails safe; the unit test passes only because it hand-writes assignee. Decide which name the store records for a dispatched worker and make the cross-repo path reachable, proven on a real dispatch.