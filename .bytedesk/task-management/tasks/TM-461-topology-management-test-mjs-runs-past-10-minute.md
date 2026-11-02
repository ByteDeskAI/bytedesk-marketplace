---
id: "TM-461"
kind: "task"
status: "done"
created: "2026-10-05T15:50:16.990Z"
board: "bytedeskai/bytedesk-marketplace"
title: "topology-management.test.mjs runs past 10 minutes in isolation"
epic: "EP-028"
acceptance: [{"text":"The file completes in under 3 minutes in a clean isolated worktree","done":true,"at":"2026-10-09T03:04:34.439Z"},{"text":"Whatever waited is bounded by a timeout with a clear failure","done":true,"at":"2026-10-09T03:04:34.925Z"}]
evidence: [".bytedesk/task-management/evidence/TM-461-1791515075378.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/239"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T03:07:10.990Z"
comments: [{"author":"main","ts":"2026-10-05T17:20:32.526Z","text":"rv-222 confirmed on #226 base: topology-management.test.mjs completes all tests (107/116 pass, 0 fail) but the process never exits — a pre-existing open handle, not a slow test."},{"author":"review-sweep","ts":"2026-10-09T03:06:13.515Z","text":"review-sweep: TM-461 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-09T03:07:10.981Z","text":"review verdict: approved — independent reviewer rv-230 (subagent, not the author) approved PR #239 at 6672687a; its R1 finding was fixed in 73097a1c before merge 09fdd6ee. https://github.com/ByteDeskAI/bytedesk-marketplace/pull/239. The verdict was delivered to the lead session, not posted on the PR."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-461-1791515075378.log":{"source":null,"sha256":"18077bf44278609b3c371ce242dd6abe2e58c684e15c7196c023bb7f132d39ec","bytes":261,"at":"2026-10-09T03:04:35.379Z"}}
closed: "2026-10-09T03:04:35.833Z"
---

rv-gov could not complete tests/unit/topology-management.test.mjs in three runs (300s, 500s, ~12 min) under --test-concurrency=1. The lead's full test:unit runs (1142 pass) and CI did complete, so it may be environment-specific (isolated HOME, missing services) — find what waits.