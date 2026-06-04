---
name: pm-board
description: Show active sprint board, tickets list, and project status.
when_to_use: Use when the user requests to see the active board, backlog, sprint status, task columns, or general project dashboard. Typical phrases: "/pm:board", "show board", "sprint status", "project status".
argument-hint: ""
user-invokable: true
disable-model-invocation: false
allowed-tools:
  - pm_status
model: inherit
---

# Project Management Sprint Board Status

Use this skill to view the active sprint columns, story points completed, and recent activity logs.

## Steps

1. Run the `pm_status` tool to fetch the board details.
2. Group and display the output columns:
   - **Active Sprint Info & Goals**
   - **Sprint Progress (Story Points Completed / Total)**
   - **Columns**: `TODO`, `IN_PROGRESS`, `REVIEW`, `DONE`
3. Present the board in a clean, human-readable table or visual list.
4. Output the last few log events to show what was changed recently.
5. If `dashboard.dashboard_url` is present in the response, surface it to the user:
   `Live dashboard: <url>` — the dashboard auto-starts as a plugin monitor and reflects changes in real time.
