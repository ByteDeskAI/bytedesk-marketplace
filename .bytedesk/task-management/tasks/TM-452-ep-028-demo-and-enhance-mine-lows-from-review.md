---
id: "TM-452"
kind: "task"
status: "open"
created: "2026-10-05T15:37:52.801Z"
board: "bytedeskai/bytedesk-marketplace"
title: "EP-028 demo and enhance-mine LOWs from review"
epic: "EP-028"
acceptance: [{"text":"Each item fixed or documented","done":false},{"text":"Tests for code changes","done":false}]
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
updated: "2026-10-05T15:37:52.809Z"
---

rv-216 LOW items: (1) enhance-mine SELF_REPORT skip runs before is_error, so an erroring enhance-mine run is never mined; CODE_READ treats any successful cat/tail/head as reading code, hiding real error codes in tailed logs; (2) docs/demo/ep-028-demo.sh claims nothing outside the sandbox changes, but may npm ci into the repo and step 9 runs doctor with the real HOME/cwd; (3) the ring CHANGELOG should say mail delivered before the seed is never rung; (4) combined doctor exit code untested via CLI; (5) prompt-ack accepts any pane descendant: document in ADR/docs.