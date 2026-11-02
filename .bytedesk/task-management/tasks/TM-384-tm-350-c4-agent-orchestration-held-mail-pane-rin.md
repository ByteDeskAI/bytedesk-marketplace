---
id: "TM-384"
kind: "task"
status: "done"
created: "2026-10-05T10:59:42.356Z"
board: "bytedeskai/bytedesk-marketplace"
title: "TM-350 C4 agent-orchestration: held-mail pane-ring fallback and task:<TM-id> worker recipient"
epic: "EP-028"
acceptance: [{"text":"Mail held leads_not_ready to a live lead rings the lead pane with a pointer after one recovery backoff; outcome recorded on the envelope","done":true,"at":"2026-10-05T13:35:37.668Z"},{"text":"task:<TM-id> resolves to the task's bound worker for same-repo senders, and cross-repo only when delegationAllows covers the task; otherwise routed to the lead","done":true,"at":"2026-10-05T13:35:38.063Z"},{"text":"A non-roster (Codex) worker bound to a task no longer ends unknown_recipient; tmux tests follow tmux-test-isolation.md","done":true,"at":"2026-10-05T13:35:38.548Z"}]
evidence: [".bytedesk/task-management/evidence/TM-384-landing.md"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/196","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/211","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/212","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/221"]
blockedBy: []
blocks: ["TM-385","TM-386","TM-393"]
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-10-05T15:29:43.183Z"
parent: "TM-350"
evidenceSources: {".bytedesk/task-management/evidence/TM-384-landing.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-384-landing.md","sha256":"9c5886027fbd9bd8834a2fe79fd0582ee6c1d8f3a4a91c191f7ff12eb3efd47d","bytes":1127,"at":"2026-10-05T13:35:38.978Z"}}
closed: "2026-10-05T13:35:39.389Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:32.789Z","text":"review-sweep: TM-384 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:29:43.179Z","text":"Independent review verdict: approved (lead-dispatched reviewer, APPROVE at e978da5f) — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/196#issuecomment-5995560308"}]
---

ADR-0041. Owns lib/standing-mailbox.mjs and lib/routing.mjs only. leads_not_ready decided at standing-mailbox.mjs:162-171; unknown_recipient at :182/185; routing.mjs:228-233,276-311. Reuse ringMessage/wakeForProbe (delivery.mjs:613/347), retryDelayMs, bindTaskWorker record.worker (management.mjs:247-257). Keep the cross-repo redirect-to-lead gate.