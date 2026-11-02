---
id: "TM-555"
kind: "task"
status: "open"
created: "2026-11-02T01:11:41.843Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: a collector loop appended one comment 19,256 times; five task files are 1-3 MB and cannot be committed"
epic: "EP-029"
acceptance: [{"text":"A supported 'tm doctor --fix' step collapses consecutive identical comments from the same author into one, recording the count, without hand-editing the store (test)","done":false},{"text":"The collector that wrote the repeats is identified, and a test proves it cannot append an identical consecutive comment","done":false},{"text":"The five files are compacted and committed; each is under 100 KB","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "72f1fc09-2253-4281-a926-682424a11029"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-02T01:11:42.211Z"
priority: "medium"
---

Found by lead fd2b831f, 2026-11-01, while committing the board (e05183d8). TM-217 holds 19,272 comments; 19,256 are author 'worker:tmux', text 'tmux worker exited after submitting its revision; independent review and integration remain required', 2026-09-24 to 2026-10-02. Affected: TM-217 (3.2 MB, already tracked), TM-234 (0.96 MB, tracked), TM-240 (2.8 MB), TM-241 (2.9 MB), TM-242 (2.5 MB). The last three and the current state of the first two were held back from e05183d8. The repeats stopped on 2026-10-02, so the source may already be fixed; confirm which collector path wrote it and that it now refuses to repeat an identical consecutive comment.