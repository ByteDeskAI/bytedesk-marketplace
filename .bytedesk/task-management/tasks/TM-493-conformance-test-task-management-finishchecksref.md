---
id: "TM-493"
kind: "task"
status: "done"
created: "2026-10-09T01:30:02.447Z"
board: "bytedeskai/bytedesk-marketplace"
title: "conformance test: task-management finishChecksRefusal agrees with agent-orchestration normalizeChecks"
epic: "EP-028"
acceptance: [{"text":"A shared fixture table runs through both validators","done":true,"at":"2026-10-09T03:04:37.156Z"},{"text":"The test fails if either side changes alone","done":true,"at":"2026-10-09T03:04:37.641Z"}]
evidence: [".bytedesk/task-management/evidence/TM-493-1791515078080.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/239"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T03:07:11.446Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-493-1791515078080.log":{"source":null,"sha256":"18077bf44278609b3c371ce242dd6abe2e58c684e15c7196c023bb7f132d39ec","bytes":261,"at":"2026-10-09T03:04:38.081Z"}}
closed: "2026-10-09T03:04:38.550Z"
comments: [{"author":"review-sweep","ts":"2026-10-09T03:06:14.335Z","text":"review-sweep: TM-493 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-09T03:07:11.438Z","text":"review verdict: approved — independent reviewer rv-230 (subagent, not the author) approved PR #239 at 6672687a; its R1 finding was fixed in 73097a1c before merge 09fdd6ee. https://github.com/ByteDeskAI/bytedesk-marketplace/pull/239. The verdict was delivered to the lead session, not posted on the PR."}]
---

TM-492 (PR #234) mirrors AO's finish-check rules in task-management instead of importing them (plugin independence). Add a conformance test, like the TM-441 mergeInOf one, that runs the same table of check shapes through both and asserts they accept and refuse the same entries.