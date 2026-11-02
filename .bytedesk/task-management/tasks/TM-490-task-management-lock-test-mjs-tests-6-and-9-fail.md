---
id: "TM-490"
kind: "task"
status: "done"
created: "2026-10-09T00:00:58.548Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: lock.test.mjs tests 6 and 9 fail on main"
epic: "EP-028"
acceptance: [{"text":"Both tests pass on main in a clean worktree","done":true,"at":"2026-10-09T03:04:31.760Z"},{"text":"Root cause recorded (code regression vs environment), and CI runs task-management unit tests if it does not","done":true,"at":"2026-10-09T03:04:32.142Z"}]
evidence: [".bytedesk/task-management/evidence/TM-490-1791515072576.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/239"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T03:07:10.520Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-490-1791515072576.log":{"source":null,"sha256":"18077bf44278609b3c371ce242dd6abe2e58c684e15c7196c023bb7f132d39ec","bytes":261,"at":"2026-10-09T03:04:32.577Z"}}
closed: "2026-10-09T03:04:32.956Z"
comments: [{"author":"review-sweep","ts":"2026-10-09T03:06:13.758Z","text":"review-sweep: TM-490 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-09T03:07:10.512Z","text":"review verdict: approved — independent reviewer rv-230 (subagent, not the author) approved PR #239 at 6672687a; its R1 finding was fixed in 73097a1c before merge 09fdd6ee. https://github.com/ByteDeskAI/bytedesk-marketplace/pull/239. The verdict was delivered to the lead session, not posted on the PR."}]
---

On origin/main (after #221/#223), task-management/tests/unit/lock.test.mjs fails 3/3 runs: 'is not blocked by a lock some older version committed to the repo' and 'treats a lock whose holder is gone as dead' (expected true, got false). Also seen by the TM-481 worker. CI stayed green, so CI may not run this file or runs it in a different environment — check both.