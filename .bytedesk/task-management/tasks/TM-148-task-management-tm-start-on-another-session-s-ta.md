---
id: "TM-148"
kind: "task"
status: "open"
created: "2026-09-10T01:22:32.629Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm start on another session's task silently reassigns ownership"
acceptance: [{"text":"tm start on a task owned by a different live session does not silently overwrite actor/session/branch/worktree","done":false},{"text":"An explicit override remains possible for a genuinely abandoned task","done":false},{"text":"A test covers the reclaim case","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "2ee26155-9e57-4cf8-8bc4-a8379f88e5a4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T01:22:38.224Z"
type: "bug"
labels: ["plugin:task-management"]
priority: "high"
---

`tm start <id>` stamps `actor`, `session`, `branch` and `worktree` with the calling session and its cwd, unconditionally. Run against a task another live session already owns — which is exactly what reclaiming a wrongly-parked task requires — it overwrites all four and the real owner disappears from the record with no warning and no event.

Observed while reclaiming TM-135 at the conductor's request. The task's real owner is session e01dd923 working in `.bytedesk/worktrees/TM-135-dispatch` on `tm/TM-135-idle-dispatch-quota-failover`. After `tm start TM-135` the record read session 2ee26155, branch main, worktree the main checkout — the integrator's session, which had written no code at all. All four were corrected by hand.

The claim is what stops two agents taking the same work, so a verb that reassigns it silently defeats the mechanism it exists to enforce.

Options worth weighing: refuse when the task has a live session that is not the caller and require `--steal` (the flag `dispatch` already has); or preserve ownership fields on a status change and only set them when the claim is genuinely new.