---
id: "TM-068"
kind: "task"
status: "done"
created: "2026-09-02T06:56:54.576Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Result protocol: task_result events + completion collectors per backend"
epic: "EP-008"
acceptance: [{"text":"structured task_result {id, run, outcome, summary} event emitted on worker completion, registered three-place (ntfy CATALOG + log-render fixture + tests)","done":true,"at":"2026-09-02T08:51:02.704Z"},{"text":"handoff() output gains a worker completion contract: report via tm ac / tm evidence / tm done","done":true,"at":"2026-09-02T08:51:02.818Z"},{"text":"collectors normalize orchestration_events/wait, fleet claude-sessions events, and tmux exit detection into task_result","done":true,"at":"2026-09-02T08:51:02.921Z"},{"text":"failure paths leave the task parked with a reason, never in_progress","done":true,"at":"2026-09-02T08:51:03.043Z"}]
evidence: [".bytedesk/task-management/evidence/TM-068-waveC-full.log",".bytedesk/task-management/evidence/TM-068-tm068.log"]
commits: []
blockedBy: ["TM-066","TM-064"]
blocks: ["TM-069"]
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T08:51:04.066Z"
touches: ["task-management/lib/dispatch/collect.mjs","task-management/lib/ntfy.mjs","task-management/lib/render.mjs","task-management/tests/unit/result.test.mjs"]
labels: ["ready-for-agent"]
closed: "2026-09-02T08:51:04.061Z"
---

