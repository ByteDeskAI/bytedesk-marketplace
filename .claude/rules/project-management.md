---
description: Jira is the work tracker and Confluence is the documentation knowledge store for ByteDesk Marketplace.
alwaysApply: true
---

# Project Management Rules

## Jira is the source of truth for work tracking
All work items in the `BDM` project on `bytedesk.atlassian.net`. **Never** local task lists, todo files, or in-memory tracking. MCP tools: `mcp__plugin_atlassian_atlassian__*` — `searchJiraIssuesUsingJql`, `getJiraIssue`, `createJiraIssue`, `editJiraIssue`, `transitionJiraIssue`, `getTransitionsForJiraIssue`, `addCommentToJiraIssue`, `createIssueLink`.

**Defaults (don't re-discover):** `cloudId = "bytedesk.atlassian.net"` (skip `getAccessibleAtlassianResources`). Project key `BDM` (name "ByteDesk Marketplace", id `10099`, software/next-gen). Confluence space id `15171589` (name "ByteDesk Marketplace", key `BDM1`). `maxResults: 10` on all JQL/CQL unless user says otherwise.

> Sibling repo `bytedesk-platform` uses **BDP** for both Jira and Confluence (project key `BDP`, Confluence space `491524`). Never mix the keys when working across repos.

## Confluence is the source of truth for documentation and knowledge
Before making decisions that depend on project documentation, prior reviews, runbooks, architecture notes, or operational context, search Confluence first. Use Atlassian search unless the user explicitly asks for CQL, then narrow to the relevant page or space. Prefer the **ByteDesk Marketplace** Confluence space (`15171589`, key `BDM1`) first, then widen only if needed.

Use Confluence for:
- design notes and architecture narratives not yet codified into ADRs
- runbooks, onboarding notes, and operational documentation
- project context that explains why a Jira issue exists or how a workflow is supposed to behave

Do not treat Confluence as a substitute for Jira issue tracking or for repo-local source-of-truth code/docs. Use it as the first documentation knowledge store, then reconcile against ADRs and code.

## Issue types — match the live BDM project
The active `BDM` project currently supports **Epic**, **Task**, and **Subtask** only. Do not invent retired issue types with labels or description text.

| Type | Use for |
|---|---|
| Epic | Multi-issue initiative spanning phases or a larger stream of work |
| Task | Default work item for implementation, bug fixes, refactors, docs, tests, infra, and reviews |
| Subtask | Smaller child of a Task or Epic-scoped Task when the parent already represents the main unit of work |

If the work would historically have been called a Feature, Story, Bug, or Request, create it as a **Task** in `BDM` and make the summary/description explicit about the intent.

## Labels (cross-cutting only)

The marketplace repo today has a narrow surface (one plugin: `fleet`), so the platform-side label taxonomy doesn't apply directly. Use the labels you actually need:

- `priority:{p0,p1,p2}` — when priority is meaningful
- `blocked`, `tech-debt`, `tdd`, `architecture` — same cross-cutting meanings as platform repo
- `plugin:<name>` — when ticket scope is one specific plugin (e.g. `plugin:fleet`)

Sibling-repo platform-specific labels (`service:*`, `phase:m*`) do **not** apply here.

## Jira task flow
1. **Retrieve work from Jira first** — before implementing, resuming, or reviewing work, query Jira for the existing item instead of relying on memory or local notes. Default query pattern: `project = BDM AND statusCategory != Done AND text ~ "<keyword>" ORDER BY updated DESC`.
2. **Read the work item before acting** — open the Jira issue and relevant Confluence/docs/PR context so the current scope, parent/child relationships, and expected outcome are clear.
3. **Create only when needed** — if no active Jira item matches, create a new **Epic**, **Task**, or **Subtask** in `BDM`. Use **Task** as the default type. Link to the parent Epic via `parent` when the work belongs to a larger initiative.
4. **Move active work to In Progress before coding** — whenever you pick up or resume an item, transition it from **To Do** to **In Progress** before making code changes. Do the same for the parent Epic when child work is actively underway.
5. **Keep Jira status aligned while the work evolves** — if scope changes, progress becomes blocked, or implementation reveals follow-up tasks, update Jira immediately: edit the issue, add a comment, create/link follow-up items, and make sure the status still reflects reality. Do not leave actively worked items in **To Do**, and do not leave finished work open.
6. **Reference `BDM-N` everywhere delivery happens** — include the Jira key in branch names when practical, commit messages, and PR titles/descriptions so status reviews can be reconciled quickly from git history.
7. **Transition to Done when the work is actually landed** — once the code is merged or otherwise definitively complete, move the issue to **Done** explicitly. GitHub closing syntax does **not** update Jira for us.
8. **Reconcile status when retrieving or reviewing existing work** — when you pick up an older item, audit whether its current Jira status still matches the repository, merged PRs, and remaining scope. Correct stale statuses as part of the work, not as a separate cleanup task.
9. **Keep epic state honest** — an Epic should usually be **In Progress** once any child is active, and should only move to **Done** when its remaining child scope is complete or intentionally descoped.

## Jira board
Built-in: `https://bytedesk.atlassian.net/jira/software/projects/BDM/boards`. Default Kanban — `In Progress` column matches the "transition before coding" rule.

## Migration from GitHub Issues
This repo is fresh (extracted from `ByteDeskAI/bytedesk-platform`); there are no predating GitHub Issues to migrate. If a GitHub Issue is opened against this repo by an outside contributor, triage by creating a `BDM` Task and closing the issue with a pointer comment (`Tracked as BDM-N`). Don't open new GitHub Issues for planning — Jira only. GitHub remains the source for code / PRs / releases / CI.
