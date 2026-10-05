---
id: "TM-244"
kind: "task"
status: "open"
created: "2026-09-25T15:17:33.610Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration + task-management: a finished task can sit with no review and nothing notices"
epic: "EP-019"
acceptance: [{"text":"A finish whose review request fails is surfaced to the owning lead (mailbox or the lead's status output) with the refusal text, and the lead has one documented verb to retry it; a test forces requestReview to throw and asserts the lead is told.","done":false},{"text":"A doctor check (ao-topology doctor or tm doctor) lists every task with a recorded commit or PR and no outstanding or completed review for its current revision, naming the reason (no admission record, review_blocked, or never requested); it can report finding none.","done":false},{"text":"The check is tested against three fixtures: ungoverned task with a PR, governed task with review_blocked, governed task with a completed review (not listed).","done":false},{"text":"Plugin independence (Ryan, 2026-09-25): task-management and agent-orchestration each work with the other absent. No import or require crosses the boundary and no manifest dependency is declared; a call into the other plugin first capability-checks it (the tm binary as at agent-orchestration management.mjs:50, or the ao-topology binary as at task-management hostcaps.mjs) and skips silently when it is missing, without failing or blocking the rest of the operation. A test runs each side with the other plugin absent.","done":false},{"text":"With agent-orchestration absent the doctor rule still runs from task-management's own records and reports review state it can see; with task-management absent the finish-report failure surfacing still works.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: ["TM-245"]
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-10-02T05:13:42.856Z"
priority: "medium"
knowledge: ["/architecture/task-management-and-agent-orchestration-stay-ind.md"]
comments: [{"author":"main","ts":"2026-10-02T05:13:42.439Z","text":"TM-288 board review (approved by Ryan 2026-10-02): unblocked. TM-240's code is merged (PR #129, f20d03b); TM-240 itself stays in progress only because its governed-completion gate refuses on an abandoned worktree. Line-reference update: the body's reference to lines 403-411 is now 410-418."}]
---

Raised 2026-09-25 by design-system lead d04c2baa after design-system TM-136 finished with no review. Correction to the report, verified at 25bd49b: the governed path already files the review automatically. workerReport (agent-orchestration/topology/lib/management.mjs:403-411) calls requestReview on every finish report and records review_request; TM-217's request (nonce b6aa1f5e, reviewer c164bf8b) was filed that way. The missing auto-file on the ungoverned path is TM-240. Two gaps remain. (1) If requestReview throws, workerReport stores review_blocked and writes one task comment; nothing retries it or tells the lead, so the task sits in ready-for-review with an empty reviewer inbox. (2) No check finds tasks that have commits or an open PR but no outstanding or completed review record, which is how TM-136 (ungoverned) and TM-235 went unnoticed until someone asked.