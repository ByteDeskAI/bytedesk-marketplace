---
id: "TM-072"
kind: "task"
status: "done"
created: "2026-09-02T06:57:43.822Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Fleet WIP and dispatch policy (poolWip, per-backend caps)"
epic: "EP-009"
acceptance: [{"text":"config dispatch.poolWip and per-backend concurrency caps enforced by the pool","done":true,"at":"2026-09-02T09:33:26.498Z"},{"text":"board-global wipLimit behavior unchanged for interactive sessions","done":true,"at":"2026-09-02T09:33:26.599Z"},{"text":"new config keys added to the settings allowlist and docs","done":true,"at":"2026-09-02T09:33:26.717Z"}]
evidence: [".bytedesk/task-management/evidence/TM-072-tm072.log"]
commits: []
blockedBy: ["TM-065"]
blocks: ["TM-073"]
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T09:33:26.938Z"
touches: ["task-management/lib/dispatch/pool.mjs","task-management/lib/enforce.mjs","task-management/lib/settings.mjs","task-management/tests/unit/policy.test.mjs"]
labels: ["ready-for-agent"]
closed: "2026-09-02T09:33:26.933Z"
---

