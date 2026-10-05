---
id: "TM-251"
kind: "task"
status: "open"
created: "2026-09-25T18:03:21.888Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: manage cleanup removes merged worktrees and branches, never develop or main"
epic: "EP-024"
acceptance: [{"text":"cleanup refuses develop, main and release/*, with a test for each","done":false},{"text":"remote branch deletion stays out of scope","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/135"]
blockedBy: []
blocks: ["TM-253"]
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["plugin:agent-orchestration"]
triagedBy: "human"
updated: "2026-10-02T05:15:42.043Z"
comments: [{"author":"main","ts":"2026-09-25T20:27:30.819Z","text":"Released from hold: Ryan approved lead autonomy directly in the marketplace lead's session on 2026-09-25 ('Approve all'). Decision recorded as ADR-0022. Still waits on TM-234."},{"author":"main","ts":"2026-10-02T05:14:51.030Z","text":"TM-288 board review (approved by Ryan 2026-10-02): partly shipped. ACs replaced with the remaining work; stale blocked-by TM-234 (done) dropped."}]
---

Plan from gateway lead d60f0608, 2026-09-25, reported as approved by Ryan in that session ('Approve as written') with the operating model: 'All I should be involved in is the planning and approving plans. team leads should drive the completion and approvals after planning until it is released and cleaned up.' This changes ADR-0001 (merge is PR-level; branch delete is repo-destructive and deploy is external, both always human) and the 'humans merge' rule, so it is held for Ryan's confirmation in the marketplace lead's session and a recorded decision. Part (b), cleanup. Branch deletion is Repo-destructive under ADR-0001 today.