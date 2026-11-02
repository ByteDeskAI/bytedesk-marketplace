---
id: "TM-405"
kind: "task"
status: "open"
created: "2026-10-05T13:37:39.428Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management + agent-orchestration: provision task worktrees from a freshly fetched origin/<integration branch>, not the checkout's stale local branch"
epic: "EP-028"
acceptance: [{"text":"tm worktree new / dispatch / manage admit branch a new task worktree from a just-fetched origin/<integration or default branch>; the record stores that ref and SHA","done":false},{"text":"If the fetch fails, provisioning proceeds from the local ref with a recorded, visible warning (or refuses when configured), never silently","done":false},{"text":"Test: a local main behind origin/main yields a worktree based on origin/main","done":false}]
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
updated: "2026-10-05T13:37:39.436Z"
---

Reported 2026-10-05 by bytedesk-agent-browser lead (Ines, c1b0c1fd), TM-028/TM-033: manage admit / tm worktree new provisioned from the main checkout's local main (8810b7f), 12 commits behind origin/main (fce2f4a). The worker then hit a guard whose fix was already on origin/main and filed a false-lead ticket. TM-201 made dispatch use a defined base (default branch or dispatch.base), but it resolves that base locally without fetching. Wanted: fetch the integration branch (or the default branch) from origin before provisioning and branch from origin/<branch>; if the fetch fails, provision from the local ref only with a recorded warning naming how far behind it may be.