---
id: "TM-437"
kind: "task"
status: "open"
created: "2026-10-05T15:34:55.294Z"
board: "bytedeskai/bytedesk-marketplace"
title: "review-sweep verdict detection cannot be satisfied by the worker or by a filename"
epic: "EP-028"
acceptance: [{"text":"Evidence named preview.png does not count as a verdict","done":false},{"text":"A verdict comment by the task's own claimant does not count","done":false},{"text":"A governed task counts only record.review on its finish revision","done":false}]
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
updated: "2026-10-05T15:37:53.225Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T15:37:53.219Z","text":"Also found independently by rv-216 on #209 (same root): for a governed task with review_blocked or never-requested, the free-text/evidence fallback is checked before the record and returns 'completed' (e.g. a worker's 'self-review passed' comment), hiding it from tm doctor and review-sweep."}]
---

Post-merge review of #203 (rv-203). reviewState counts any evidence path matching /review/i (so ui-preview.png) and any VERDICT_TEXT comment, including the worker's own 'self-review: tests passed', even for governed tasks.