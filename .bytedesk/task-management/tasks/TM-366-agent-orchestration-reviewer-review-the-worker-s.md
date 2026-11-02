---
id: "TM-366"
kind: "task"
status: "done"
created: "2026-10-05T10:57:13.221Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration reviewer: review the worker's worktree, not the main checkout"
epic: "EP-028"
acceptance: [{"text":"Review range and file reads resolve from the worker's worktree","done":true,"at":"2026-10-05T14:15:32.703Z"},{"text":"Test proves a change only in the worktree is reviewed","done":true,"at":"2026-10-05T14:15:33.059Z"}]
evidence: [".bytedesk/task-management/evidence/TM-366-1791209733467.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/205"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:29:45.361Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T13:17:13.715Z","text":"Queued for EP-028 worker w-review (same PR as its lead task); will be claimed when a WIP slot frees."},{"author":"review-sweep","ts":"2026-10-05T15:18:29.996Z","text":"review-sweep: TM-366 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:19:12.983Z","text":"Marketplace lead (fd2b831f): PR #205 merged to main at 2f1d6593 with no review recorded. Independent post-merge review commissioned (review-205); findings will be filed as tasks and the verdict recorded here."},{"author":"main","ts":"2026-10-05T15:27:49.830Z","text":"Post-merge review of PR #205 (lead-dispatched, 2026-10-05): DEFECTS. HIGH-1 -> TM-427 (forged review submit), HIGH-2 -> TM-428 (worktree .gitattributes hides patch). MEDIUM-3 (reviewer told to read files under the worker-controlled worktree; worker can edit after finish) is fixed with TM-428: host-owned read-only snapshot at the exact revision, or at minimum requestReview asserts worktree HEAD == revision and clean. Verified sound: A cannot satisfy B (keyed task-revision, nonce, patch_sha256, incarnation re-checked); admission worktree is host-written; request lookup is traversal-safe."},{"author":"main","ts":"2026-10-05T15:29:45.355Z","text":"Independent post-merge review verdict on PR #205: changes requested (DEFECTS — HIGH TM-427 forged review submit, HIGH TM-428 worktree attributes hide the patch, MEDIUM-3 folded into TM-428, MEDIUM-4/5 on TM-364). Fixes in progress; the merged code must not be treated as reviewed-approved."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-366-1791209733467.log":{"source":null,"sha256":"34e39da4c1d3f56813d0de191915a9d9e50876222d77620e2253683d2bd7c38d","bytes":324,"at":"2026-10-05T14:15:33.467Z"}}
closed: "2026-10-05T14:15:33.868Z"
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (C2-2). Gateway 09-24 finding.