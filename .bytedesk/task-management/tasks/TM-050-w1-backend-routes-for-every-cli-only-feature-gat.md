---
id: "TM-050"
kind: "task"
status: "done"
created: "2026-09-01T20:13:40.230Z"
board: "bytedeskai/bytedesk-marketplace"
title: "W1 backend routes for every CLI-only feature + gateStart + SSE upgrade"
epic: "EP-006"
acceptance: [{"text":"./run-tests.sh unit passes","done":true,"at":"2026-09-01T20:31:22.022Z"},{"text":"bash tests/test-dashboard.sh passes with the new route assertions","done":true,"at":"2026-09-01T20:29:51.912Z"}]
evidence: []
commits: ["545c77f"]
blockedBy: []
blocks: []
actor: "main"
session: "126c1a80-f656-456d-bf04-5c79ad0494c2"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-01T20:31:22.131Z"
parkedReason: "backend committed at 545c77f; AC1 (unit suite green) waits on FE-core relocating filters.ts so tests/unit/query.test.mjs can be repointed"
closed: "2026-09-01T20:31:22.127Z"
---

