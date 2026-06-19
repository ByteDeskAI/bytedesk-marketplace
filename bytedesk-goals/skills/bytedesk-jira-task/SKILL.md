---
name: bytedesk-jira-task
description: Full Jira task lifecycle manager for the ByteDesk Platform (BDP) project. Use this skill whenever you need to create, update, transition, or link Jira issues in the BDP project — including creating tasks before coding, moving items to In Progress, adding progress comments, linking child tasks to parent Epics, and transitioning to Done after merging. Invoke proactively whenever work begins, scope changes, or code lands. Also use when the user says "create jira", "start a task", "mark done", "open a ticket", "update jira", "transition to in progress", or any similar phrase.
user-invokable: true
argument-hint: "[BDP-N | create | done | in-progress | comment]"
allowed-tools:
  - mcp__atlassian__searchJiraIssuesUsingJql
  - mcp__atlassian__getJiraIssue
  - mcp__atlassian__createJiraIssue
  - mcp__atlassian__editJiraIssue
  - mcp__atlassian__transitionJiraIssue
  - mcp__atlassian__getTransitionsForJiraIssue
  - mcp__atlassian__addCommentToJiraIssue
  - mcp__atlassian__createIssueLink
  - mcp__atlassian__getJiraIssueTypeMetaWithFields
  - mcp__atlassian__getJiraProjectIssueTypesMetadata
  - mcp__atlassian__getIssueLinkTypes
---

## Fixed Project Defaults

Never call `getAccessibleAtlassianResources` — these are already known:

- **cloudId**: `bytedesk.atlassian.net`
- **Project key**: `BDP` (id `10000`)
- **Confluence spaceId**: `491524`
- **maxResults**: 10 on all JQL/CQL

## Issue Types

Only three types exist in BDP. Never invent others (Feature, Story, Bug, etc.):

| Type | Use for |
|---|---|
| Epic | Multi-issue initiative spanning phases or a larger stream of work |
| Task | Default for everything: implementation, bug fixes, refactors, docs, tests, infra |
| Subtask | Smaller child of a Task when the parent already represents the main unit of work |

## Labels

Use only these established label sets (don't invent new ones):

- `phase:m0` … `phase:m6` — milestone grouping
- `service:sales`, `service:ai`, `service:tools`, `service:web`, `service:gateway`, `service:identity`, `service:dev`, `service:agent`
- `priority:p0`, `priority:p1`, `priority:p2`
- `tdd`, `architecture`, `blocked`, `tech-debt`

Workflow-native support tickets (ADR-0091) may also use:

- `bytedesk-support`
- `automation:auto-resolution`
- `source:devprojects`, `source:teamcity`, `source:observability`, `source:customer-portal`, `source:platform-system`
- `support:bug`, `support:incident`, `support:issue`, `support:regression`, `support:request`
- `delivery:work-tab`, `delivery:preview`, `delivery:production-requested`, `delivery:prod-auto`

Use these only for tickets filed by the support-ticket workflow, not ordinary implementation tasks.

## Task Lifecycle — The Complete Workflow

### Step 1: Retrieve before creating

Before creating a new issue, always search for an existing one:

```
searchJiraIssuesUsingJql:
  jql: project = BDP AND statusCategory != Done AND text ~ "<keyword>" ORDER BY updated DESC
  maxResults: 10
```

If a match exists, use it. Only create new issues when nothing suitable exists.

### Step 2: Create (when needed)

Create a Task with these fields:
- **summary**: Clear, action-oriented (e.g., "Add HVAC lead scraper for AZ ROC")
- **description**: What + why + acceptance criteria
- **parent** (if child work): link to the Epic
- **labels**: appropriate from the label sets above

Use `createJiraIssue` with `issuetype: "Task"` (or `"Epic"` / `"Subtask"` as appropriate).

### Step 3: Transition to In Progress before coding

Always call `transitionJiraIssue` to move the issue to **In Progress** before making any code changes. Never write code against a To Do issue.

To get valid transition IDs: call `getTransitionsForJiraIssue` first if unsure. "In Progress" is typically transition id `21` in BDP, but always verify.

### Step 4: Add comments on significant progress

Use `addCommentToJiraIssue` when:
- Scope changes from what the issue originally described
- A blocking issue is discovered
- A PR is opened (include PR URL)
- A decision was made that future readers need to understand

### Step 5: Link related issues

Use `createIssueLink` to connect related work:
- `inwardIssue` / `outwardIssue` + `type: "Relates"` for lateral relationships
- The parent field handles parent-child; use `createIssueLink` only for peer relationships

Use `getIssueLinkTypes` if unsure which link type names are available.

### Step 6: Transition to Done after merge

After code is merged to `develop` (or `main` for hotfixes), call `transitionJiraIssue` to move to **Done**. GitHub closing syntax does NOT update Jira — always do this explicitly.

Also check the parent Epic: if all child tasks are Done, transition the Epic to Done too.

## Reference Branch/Commit Naming

Include `BDP-N` in:
- Branch names: `feature/BDP-123-add-hvac-scraper`
- Commit messages: `feat(tools): add AZ ROC scraper BDP-123`
- PR titles: `BDP-123: Add HVAC lead scraper for AZ ROC`

## Output Format

After each Jira operation, confirm to the user:

```
BDP-123 created → https://bytedesk.atlassian.net/browse/BDP-123
Status: In Progress
Labels: service:tools, priority:p1
```

If transitioning or commenting, confirm the new state and the issue URL.