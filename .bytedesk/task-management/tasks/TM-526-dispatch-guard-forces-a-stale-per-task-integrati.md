---
id: "TM-526"
kind: "task"
status: "open"
created: "2026-10-09T07:22:01.883Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Dispatch guard forces a stale per-task integration base on a governed task (passport TM-262)"
epic: "EP-029"
acceptance: [{"text":"A governed task admitted on an older base can integrate onto the current default branch with no refused git operation (test)","done":false},{"text":"The lead has a supported way to refresh a task's integration base, and stale bases are reported by doctor","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T09:45:11.181Z"
comments: [{"author":"main","ts":"2026-10-09T09:44:54.917Z","text":"Overlaps TM-528 (Greta, passport): started governed records keep base f0b29dd (old main) because Passport has no management.target_branch, and admission only widens a base, so review ranges are 1,000+ files (TM-262: 31 files vs program/passport-goals-import, 1,022 from f0b29dd). Fix TM-526 and TM-528 together: a server-verified re-base of a started record once target_branch is configured, a warning at admission, and doctor reporting stale bases."}]
links: [{"type":"relates to","id":"TM-528"}]
---

Split from TM-521 (audit-transcripts.md problem 5, first half; evidence .bytedesk/task-management/evidence/EP-autonomy/audit-transcripts.md). On passport TM-262 the dispatch and worker guard pinned the task's integration base to a stale revision, so the worker could not integrate onto the current default branch without a refused git operation. Find where the per-task integration base is recorded and frozen (dispatch, admission or worker-guard), and make a governed task's base follow the default branch at start-worker or rework time, or give the lead a verb to refresh it. Related: TM-479 (dispatch froze an already-merged branch as the base).