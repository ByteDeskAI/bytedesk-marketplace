---
id: "TM-492"
kind: "task"
status: "done"
created: "2026-10-09T01:16:31.197Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: readyForReview refuses structured finish checks (TM-418), so no governed task following the handoff can reach review-ready"
epic: "EP-028"
acceptance: [{"text":"readyForReview accepts structured check runs (objects with name, command, exit_code, revision) as well as strings, sharing one validator with agent-orchestration's finish validation","done":true,"at":"2026-10-09T01:29:53.817Z"},{"text":"Its refusal names the field that failed","done":true,"at":"2026-10-09T01:29:54.181Z"},{"text":"A test submits a TM-418-shaped finish and reaches ready-for-review","done":true,"at":"2026-10-09T01:29:54.594Z"}]
evidence: [".bytedesk/task-management/evidence/TM-492-1791509395126.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/234"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
filedBy: {"board":"bytedeskai/bytedesk-marketplace","agent":"a33a204b","task":"TM-485"}
labels: ["decision:intake","needs-triage"]
triagedBy: "auto"
triageMissing: ["label decision:intake"]
updated: "2026-10-09T01:29:55.559Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-09T01:29:04.727Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/234 @ 4fa06afc (independent review + delta rv-230)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-492-1791509395126.log":{"source":null,"sha256":"bc6dde9ef89b50930f6e417f758b7ae74aa377b551e667d9e2aef6804c8baf94","bytes":270,"at":"2026-10-09T01:29:55.127Z"}}
closed: "2026-10-09T01:29:55.549Z"
---

task-management/lib/governance.mjs readyForReview (line ~29-33) requires finish.checks to satisfy strings(): every item a non-empty string. TM-418 (agent-orchestration) made finish checks structured runs {name, command, exit_code, revision, log_tail}, and the worker handoff tells workers to submit exactly that. So 'ao-topology manage report' records the finish (producer state ready-for-review), then its callback 'tm review-ready <id> --revision <sha>' throws 'submit the producer finish report…; review-ready only reflects an accepted exact-revision finish', and the board never reaches ready-for-review. Reproduced on TM-485 at 3df30083: with the real record, every condition is true except strings(finish.checks) (checks[0] is an object). This is the rule-3 shape: one caller (ao finishCheckEvidence) was updated, its sibling (tm governance) was not. The error text also names the wrong cause; it should say which field was refused.