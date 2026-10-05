---
id: "TM-288"
kind: "task"
status: "in_progress"
created: "2026-10-02T03:58:03.838Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Re-evaluate the whole board after the EP-019 orchestration work: remove, update or modify items it completed or changed"
epic: "EP-023"
acceptance: [{"text":"every open, blocked and parked task and every open epic on this board has been reviewed against the shipped work, with a recorded outcome (closed with evidence / updated / merged / unchanged with reason)","done":true,"at":"2026-10-02T04:30:23.255Z"},{"text":"a review report lists each changed item with the reason, attached as evidence","done":false},{"text":"no item is closed without evidence that the shipped work covers its acceptance criteria","done":false}]
evidence: [".bytedesk/task-management/evidence/TM-288-board-review.md",".bytedesk/task-management/evidence/TM-288-applied.md"]
commits: []
blockedBy: ["TM-284","TM-285","TM-286"]
blocks: []
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-02T05:16:36.650Z"
priority: "high"
evidenceSources: {".bytedesk/task-management/evidence/TM-288-board-review.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-288-board-review.md","sha256":"ed7f9cfbae92b509e64cae65512005370365914d8cf8db10ab77b761d76619df","bytes":8836,"at":"2026-10-02T04:30:22.964Z"},".bytedesk/task-management/evidence/TM-288-applied.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-288-applied.md","sha256":"a1adba4ac7c68f7bc5d4b77ec0644408cbd8a29222c3e3df0b3cc9ba5462e0cc","bytes":9060,"at":"2026-10-02T05:16:36.644Z"}}
---

User request (2026-10-02). The orchestration work of 2026-10-01/02 shipped: process-compose managed services (TM-272, gateway TM-457), NATS reconnect (TM-277), darwin backend (TM-273), ADR-0030 session naming (TM-274), tmux test isolation (TM-281), pointer identity (TM-283), NATS persona registry (TM-279), re-spawn handoff (TM-280), presence session-names addendum (PR #147); in flight: setup self-heal (TM-284/285/286), presence defect TM-287, macOS sandbox TM-282. Many older tasks on this board (and EP-019/EP-021 in particular) may now be done, obsolete, duplicated, or need updated scope — e.g. anything about the 24h session-host scope, ao-<id> session names, the hand-run session host, NATS crashes, test tmux isolation, unsupervised daemons, or Codex/Grok cache drift. Review every open/blocked/parked task and epic against what shipped (read the runbook runbooks/ao-rollout-lessons-managed-services-naming-multi and the CHANGELOG 0.12.0–0.14.0), and for each: close with evidence, update scope/AC, merge into a duplicate, or leave with a note why it still stands. Produce a short review report listing every change made.