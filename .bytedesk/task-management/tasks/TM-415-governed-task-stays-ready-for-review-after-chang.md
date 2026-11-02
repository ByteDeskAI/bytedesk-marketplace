---
id: "TM-415"
kind: "task"
status: "done"
created: "2026-10-05T14:09:16.650Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Governed task stays ready-for-review after changes_requested, so no next-round worker can be dispatched"
epic: "EP-028"
acceptance: [{"text":"Collecting a changes_requested verdict (or start-worker for the next round) returns the governed task to working without tm override","done":true,"at":"2026-10-08T23:34:18.581Z"},{"text":"A test covers admit, finish, changes_requested, start-worker for round 2","done":true,"at":"2026-10-08T23:34:18.944Z"}]
evidence: [".bytedesk/task-management/evidence/TM-400-landing.md"]
commits: []
blockedBy: ["TM-347"]
blocks: []
actor: "main"
session: "2d38b07f-c03b-4c88-a0c4-0f0bdf7379f8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-08T23:34:19.810Z"
comments: [{"author":"main","ts":"2026-10-05T14:25:45.123Z","text":"Lead triage (fd2b831f): duplicate of TM-347. PR #192 adds 'ao-topology manage rework --task <id>' (refused unless the current finish revision's review is changes_requested; resets record+governance to working; next finish needs a new revision). Merged to fix/ao-local-nats-autostart 08fb4004; reaches main via TM-400. Close as duplicate when TM-347 lands on main."},{"author":"main","ts":"2026-10-08T23:34:18.130Z","text":"Closed as delivered by TM-347 (duplicate): 'ao-topology manage rework --task <id>' returns a changes_requested governed task to working (record + governance), so start-worker runs round 2 without tm override; full-cycle test in topology-management.test.mjs. Independent review verdict: approved (PR #192; https://github.com/ByteDeskAI/bytedesk-marketplace/pull/192#issuecomment-5996030129). On main via PR #221 at 44b030d4."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-400-landing.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-400-landing.md","sha256":"d20428878421a129cc1ef6448861e8579c984a5646e1f081efeb64389588b221","bytes":974,"at":"2026-10-08T23:34:19.398Z"}}
closed: "2026-10-08T23:34:19.804Z"
---

Seen in Bastion 2026-10-05, TM-030, revision 541aa8c, reviewer verdict changes_requested (nonce 92e0503d).
ao-topology manage start-worker --task TM-030 --backend tmux fails: TM_GOVERNED_ADMISSION_REQUIRED 'admitted ownership or working state does not match the task'. task-management/lib/governance-check.mjs:63 governedAdmission requires task.governance.state === 'working', but readyForReview (governance.mjs) sets it to 'ready-for-review' and nothing (collect of a changes_requested verdict, manage admit resume, start-worker) sets it back. Re-running manage admit returns 'admitted (resumed)' without changing the state.
docs/repository-leads.md says start-worker starts the next round after changes are requested; it cannot for any governed task.
Workaround in use: tm override with a recorded reason for the single dispatch.