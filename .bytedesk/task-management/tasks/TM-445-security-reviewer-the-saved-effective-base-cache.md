---
id: "TM-445"
kind: "task"
status: "open"
created: "2026-10-05T15:35:37.257Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY reviewer: the saved effective base cache can shrink the reviewed range"
epic: "EP-028"
acceptance: [{"text":"The server is asked first; the cache is used only when the server cannot answer","done":false},{"text":"A tampered cache entry cannot narrow the range when the server is reachable (test)","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/release/agent-orchestration-0.16.1"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T01:21:45.692Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T15:50:19.750Z","text":"rv-gov on #210 adds (LOW): a cache hit returns before the check that the PR targets the integration branch; run that check first or record the PR base in the cache entry."},{"author":"main","ts":"2026-10-09T01:00:20.799Z","text":"Implemented inside the TM-427 governed cluster worker (tmux:tm-TM-427) per TM-427 comment 7; one PR against main."}]
---

w-secreview on #216. reviewRangeBase (~983) uses <task>.bases.json before asking the server; any base between admitted and revision is accepted, so writing base=<rev>^ limits request, packet and eligibility to the last commit.