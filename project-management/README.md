# Localized Project Management Plugin (`project-management`)

An MCP-based project management tool designed to replicate the essential features of the Atlassian stack (Jira and Confluence) in a lightweight, localized, and Git-friendly workspace.

It supports task/issue tracking, sprint planning, project dashboard metrics, and markdown-based wiki document page trees.

## Features

- **Jira Equivalent (Task Management & Tracking)**:
  - Create, view, update, list, and transition issues (`TODO`, `IN_PROGRESS`, `REVIEW`, `DONE`).
  - Sprint lifecycle management (create, start, complete, rollover).
  - Assignees, priorities, epic links, comments, and story complexity points estimation.
- **Confluence Equivalent (Documentation)**:
  - Create, read, and search markdown-based wiki documents.
  - Page parent/child hierarchy support.
- **Git Friendly**:
  - All data is saved as human-readable, structured JSON files in a local `.pm/` folder inside your repository. No database server is needed, making your ticket board and wiki fully versionable in Git!
- **Fast Load Time**:
  - Custom stdio-based JSON-RPC parser written in plain Python with zero heavy dependencies, booting in under 10ms.

## Directory Structure

When initialized, the plugin creates the following layout in your project workspace:
```
<project-root>/
└── .pm/
    ├── project.json   # Project configuration, active sprint info, and activity log
    ├── issues/
    │   ├── PM-1.json  # Tickets stored as raw JSON files
    │   └── PM-2.json
    └── docs/
        ├── DOC-1.json # Confluence pages stored as JSON structures
        └── DOC-2.json
```

## Slash Commands & Tools

### Initializing
- `/pm:init [project_name] [--prefix KEY]` - Set up the localized tracker.
  - Tool backing: `pm_init`

### Issue Tracking & Board Status
- `/pm:board` - View active sprint stats, columns (TODO, IN PROGRESS, REVIEW, DONE), story points completed, and recent updates.
  - Tool backing: `pm_status`
- `/pm:ticket create <title> [--desc DESCRIPTION] [--type TYPE] [--priority PRIORITY]` - Create a new issue.
  - Tool backing: `pm_issue_create`
- `/pm:ticket <id> --status <status>` - Transition a ticket (e.g. `PM-1` to `IN_PROGRESS`).
  - Tool backing: `pm_issue_update`
- `/pm:ticket <id> --comment "Message"` - Append a comment to a ticket.
  - Tool backing: `pm_issue_update`
- `/pm:ticket <id>` - View ticket details and comments list.
  - Tool backing: `pm_issue_get`
- `/pm:ticket list [--status status] [--assignee name] [--query query]` - Search and list issues.
  - Tool backing: `pm_issue_list`

### Sprint Management
- `/pm:sprint create <name> [--goal goal]` - Plan a new sprint.
  - Tool backing: `pm_sprint_manage` with `action="create"`
- `/pm:sprint start <sprint-id>` - Activate a planned sprint.
  - Tool backing: `pm_sprint_manage` with `action="start"`
- `/pm:sprint complete <sprint-id>` - Complete the active sprint (rolls unfinished tasks to backlog).
  - Tool backing: `pm_sprint_manage` with `action="complete"`
- `/pm:sprint list` - List sprints and status.
  - Tool backing: `pm_sprint_manage` with `action="list"`

### Documentation Wiki (Wiki Docs)
- `/pm:doc create <title> [--content "body"] [--parent DOC-id]` - Create a wiki page.
  - Tool backing: `pm_doc_create`
- `/pm:doc <id>` - Read a wiki page's markdown body.
  - Tool backing: `pm_doc_get`
- `/pm:doc list [--query keyword]` - Search or list documents.
  - Tool backing: `pm_doc_list`
