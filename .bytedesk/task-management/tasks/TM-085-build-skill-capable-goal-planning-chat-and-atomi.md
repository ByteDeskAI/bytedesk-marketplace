---
id: "TM-085"
kind: "task"
status: "blocked"
created: "2026-09-02T18:13:17.951Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Build skill-capable goal-planning chat and atomic board import"
epic: "EP-013"
acceptance: [{"text":"A user can converse about a goal, attach allowed documents, restart the dashboard, and resume the session.","done":false},{"text":"The planner can conduct interview/map/spec/tickets/epic/ADR/goal-import workflows and apply approved board changes through shared task-management functions rather than direct file edits.","done":false},{"text":"All mutations show exact consequences, require applicable approval, preserve refusals verbatim, and appear on the live board event stream.","done":false},{"text":"Single-goal, one-epic, and multi-epic program proposals validate and import completely or leave no partial board/filesystem state.","done":false},{"text":"Uploads are path-confined, sanitized, type/size limited, hashed, treated as untrusted context, and cannot enable privileged skills.","done":false},{"text":"The UI matches the approved mockups and passes keyboard, screen-reader, reduced-motion, responsive, offline, and failure-state checks.","done":false},{"text":"Unit, API, import round-trip, security, dashboard build, and browser tests pass; committed dashboard dist is rebuilt.","done":false},{"text":"The browser/backend contract uses AG-UI events and translates a user-selected trusted ACP coding-agent session; task-management does not depend on the Claude Agent SDK.","done":false},{"text":"The selected ACP planner receives governed task-management skills/tools, while write operations remain server-mediated and approval-gated.","done":false}]
evidence: []
commits: ["422982c","aed16bc"]
blockedBy: ["TM-084"]
blocks: ["TM-086"]
actor: "main"
session: "01a062eb-2024-7368-bdb3-ad3fcf853ad4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T11:25:22.950Z"
labels: ["ready-for-agent"]
touches: ["task-management/**"]
comments: [{"author":"main","ts":"2026-09-02T18:17:33.310Z","text":"Architecture correction: product runtime is AG-UI frontend/server streaming over a selected ACP coding agent. Claude Agent SDK is not a task-management dependency; Claude may only participate through a catalogued ACP adapter if selected."}]
---

Implement the full Plans-area vertical slice with Claude Fable 5.1: persistent bounded planning sessions, secure repository and uploaded attachments, task-management skill execution through server-mediated typed operations, proposal and board-diff preview, explicit approvals, single/epic/multi-epic packages, atomic import, responsive accessible UI, and audit events.
