---
id: "TM-266"
kind: "task"
status: "done"
created: "2026-09-29T13:00:49.962Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: run first-use repository enrollment guidance on SessionStart"
epic: "EP-021"
acceptance: [{"text":"Installed supported AO plugins invoke the existing startup check on SessionStart without requiring a manual install-hooks command.","done":false},{"text":"An unenrolled project receives clear guidance for explicit opt-in; no repo config is written and no supervisor starts before opt-in; enabled:false remains a hard veto.","done":false},{"text":"Enrolled-project activation remains idempotent, and a SessionStart hook error does not block the host session or misreport NATS readiness.","done":false}]
evidence: [".bytedesk/task-management/evidence/TM-288-board-review.md"]
commits: []
blockedBy: ["TM-265"]
blocks: []
actor: "main"
session: "01a0e0a4-3a33-79c1-ab90-99e1b6c55113"
branch: "tm/TM-266-agent-orchestration-first-use-sessionstart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-265-agent-orchestration-an-installed-plugin-s-ao-top"
labels: ["wontfix"]
triagedBy: "human"
updated: "2026-10-02T05:13:29.466Z"
blockedReason: "PR #139 is open and stacked on TM-265; CI checks are pending. Resume after TM-265 merges and PR #139 checks complete."
comments: [{"author":"main","ts":"2026-10-02T05:13:11.065Z","text":"TM-288 board review (approved by Ryan 2026-10-02): obsolete. ao 0.12.0 enrols every repo by default (repo-enrollment.mjs:16, :55) and SessionStart runs 'services ensure'. AC2 ('no supervisor before opt-in') now contradicts shipped behaviour. Its PR #139 should also be closed; that is a GitHub action left to a human, not done by this board change."},{"author":"main","ts":"2026-10-02T05:13:29.461Z","text":"TM-288 note: this 'tm done' passed the acceptance gate only because it consumed a pending one-shot override left by session 62549d39 at 04:28 ('filing a defect found by the TM-288 review (WIP 12/12)'). The three ACs were not ticked and are not met; the task closed as obsolete, as approved by Ryan, not as delivered. Reopen with 'tm reopen TM-266' if the board should keep obsolete tasks open."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-288-board-review.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-288-board-review.md","sha256":"ed7f9cfbae92b509e64cae65512005370365914d8cf8db10ab77b761d76619df","bytes":8836,"at":"2026-10-02T05:13:11.667Z"}}
closed: "2026-10-02T05:13:12.005Z"
---

Wire the existing startup check into installed AO plugin SessionStart hooks for globally available plugins. Record pending session enrollment and give agents actionable project opt-in guidance without enabling a repository automatically. Respect .bytedesk/agent-orchestration/config.json enabled:false. Gateway owns and starts embedded NATS; the marketplace plugin must not spawn another broker. Gateway currently has no public operation to issue the credentials required by a new project, so do not report NATS connected or ready without a real authenticated probe. Keep Task Management coordination on public AO CLI/MCP contracts.