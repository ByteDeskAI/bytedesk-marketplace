---
name: pm-ticket
description: Create, view, update, transition, or comment on tickets.
when_to_use: Use when the user wants to manage issues/tickets (create a task/bug, update ticket status, transition columns, assign a ticket, view comments, add comments, list backlog/tickets). Typical phrases: "/pm:ticket", "/pm:ticket create", "create bug", "move PM-1 to IN_PROGRESS", "assign PM-2 to alice", "comment on PM-3".
argument-hint: "[action] [id/title] [options]"
user-invokable: true
disable-model-invocation: false
allowed-tools:
  - pm_issue_create
  - pm_issue_update
  - pm_issue_get
  - pm_issue_list
  - pm_sprint_manage
model: inherit
---

# Project Ticket (Issue) Management

Manage Jira-like issues in your local workspace.

## Ticket Actions

- **Create**: Run `pm_issue_create` with title, type (`bug`, `story`, `task`, `epic`), priority (`low`, `medium`, `high`, `critical`), description, and assignee.
- **Update / Transition**: Run `pm_issue_update` to modify ticket fields (title, description, priority, assignee, story_points, sprint_id) or change status (`TODO`, `IN_PROGRESS`, `REVIEW`, `DONE`).
- **Comment**: Add comments to a ticket by calling `pm_issue_update` with `comment="Your comment message"`.
- **View Details**: View a single ticket's fields, history, and comments list using `pm_issue_get`.
- **List / Backlog**: Search and list tickets with optional filtering using `pm_issue_list`.
