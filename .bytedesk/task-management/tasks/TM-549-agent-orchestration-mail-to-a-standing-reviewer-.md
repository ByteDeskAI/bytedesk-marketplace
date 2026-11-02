---
id: "TM-549"
kind: "task"
status: "blocked"
created: "2026-11-01T21:24:08.962Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: mail to a standing reviewer reports 'delivered' but is never read, and a PR with no admission record cannot be reviewed at all"
epic: "EP-019"
acceptance: [{"text":"mailbox send to a reviewer either refuses with a pointer to 'reviewer request' or the reviewer reads and answers it; it is never silently ignored as delivered (test)","done":false},{"text":"A lead can request review of an ungoverned PR by explicit base and head revisions, recorded with lead attribution (test), or the refusal names the supported command that admits it first","done":false}]
evidence: []
commits: []
blockedBy: ["TM-414"]
blocks: []
actor: "main"
session: "72f1fc09-2253-4281-a926-682424a11029"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-01T21:24:15.769Z"
priority: "high"
---

Reported by design-system lead d04c2baa, 2026-11-01. (1) 'ao-topology mailbox send --to e16d04f0' with a review request shows status delivered, but the reviewer only reads its requests/ directory and answers 'the inbox has no requests/ directory, so no reviews are waiting'. The sender is told delivered for a message the recipient's role never reads. Same gap as TM-414 (reviewer does not read mail). (2) 'ao-topology reviewer request --task TM-145 --revision <sha>' fails with TOPOLOGY_REVIEWER_RANGE 'Review requires the task admission record and its current completed revision' for a PR that was never governed, so there is no supported route to the reviewer for ungoverned work. Workaround: independent review subagents. Repro: in design-system, mailbox send a review request to the reviewer and watch it report no reviews waiting; then reviewer request for an unadmitted task.