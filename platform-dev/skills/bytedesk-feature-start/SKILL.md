---
name: bytedesk-feature-start
description: >-
  ByteDesk feature kickoff orchestrator. Use when starting a new feature, bug fix,
  or development task. Finds or creates the Jira task, transitions it to In
  Progress, creates a dedicated worktree from origin/develop, scaffolds TDD red
  tests, and checks for config changes. Invoke for "start feature", "let's build
  BDP-N", "kick off", "begin work on", or similar work-start phrasing.
user-invokable: true
argument-hint: "[BDP-N | feature description]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - mcp__atlassian__searchJiraIssuesUsingJql
  - mcp__atlassian__getJiraIssue
  - mcp__atlassian__createJiraIssue
  - mcp__atlassian__editJiraIssue
  - mcp__atlassian__transitionJiraIssue
  - mcp__atlassian__getTransitionsForJiraIssue
  - mcp__atlassian__addCommentToJiraIssue
  - mcp__atlassian__createIssueLink
---

## What This Skill Does

Every feature on ByteDesk follows the same kickoff sequence. This skill runs it end-to-end so nothing gets skipped.

## Kickoff Sequence

### 1. Find or create the Jira task

Search BDP first — don't create duplicates:

```
searchJiraIssuesUsingJql:
  jql: project = BDP AND statusCategory != Done AND text ~ "<feature-keyword>" ORDER BY updated DESC
  maxResults: 10
```

If found: read the issue, understand current scope and any comments. If not found: create a Task (see `bytedesk-jira-task` skill for creation rules).

Transition to **In Progress** before touching any code.

### 2. Create the worktree via the platform operator

Branch creation and localDev lifecycle are owned by `scripts/dev/workflow.mjs` (ADR-0058). This skill's job is to construct the ByteDesk-specific kickoff context, create the worktree, and hand the user the exact next command for continuing inside that worktree.

Create the worktree from `origin/develop`:

```bash
node scripts/dev/workflow.mjs new BDP-123-short-slug origin/develop
cd .claude/worktrees/BDP-123-short-slug
```

Branch format is always `feature/BDP-N-short-slug`. Base is always `origin/develop` (never `main`, never another feature branch unless the user explicitly says to stack).

Worktrees don't share dependency state with the current tree. Run `npm install` in `src/ByteDesk.Web/` (or `dotnet restore` from `src/`) before any build/test step.

Dev infrastructure (k8s, Postgres, Redis, Helm releases) is OS-global, so only one worktree at a time can run the dev server.

If the user explicitly asks for "in place", "no worktree", or "stay here", stop and explain that ByteDesk feature work is worktree-first. The canonical checkout is reserved for updating `develop`, worktree management, release/back-merge bookkeeping, and inspection.

### 4. Bake rule pointers into the spawn prompt

The spawned Claude has no chat history — only the prompt. So **list the applicable rule files in the prompt itself** so it reads them before writing code. Map work-type → rules:
- `.cs` files → `.claude/rules/backend.md`, `.claude/rules/inter-service.md`
- Frontend files → `.claude/rules/frontend.md`, `.claude/rules/frontend-configuration.md`
- DB/migrations → `.claude/rules/database.md`
- New services → `.claude/rules/kubernetes.md`, `.claude/rules/backend.md`
- Helm/k8s → `.claude/rules/kubernetes.md`
- New/changed service boundaries → `/bytedesk-architecture-sync` (read `docs/architecture/anchors.yaml` partition)

Also tell the prompt to check `docs/architecture/adr/` for ADRs covering the area, and to read its CLAUDE.md (auto-loaded) before touching code. If the feature adds a service or cross-service edge, include: run `architecture-sync --mode working-tree` before commit and stage `workspace.dsl` with code.

### 5. Scaffold the TDD red test (for .NET work)

Per the TDD three laws: the test must exist before any implementation. Create the test file first.

Location pattern: `tests/ByteDesk.{ServiceName}.Tests/` (Unit or Integration subdirectory as appropriate).

The test must:
- Have `[Trait("Category", "Unit")]` (or `"Integration"`) for the test filter
- Start red (failing) — do not write implementation yet
- Have a descriptive name that documents the expected behavior

Example scaffold:
```csharp
[Trait("Category", "Unit")]
public class AzRocScraperTests
{
    [Fact]
    public async Task ScrapeAsync_WhenCsvValid_ReturnsParsedLeadRecords()
    {
        // Arrange
        // Act
        // Assert - will fail until implementation exists
        Assert.Fail("Not implemented yet");
    }
}
```

### 6. Check for config changes

If the feature requires new environment variables:
- Add them to `src/.env.example` immediately (contract first)
- Match the naming convention in `docs/environment.md`
- The Helm values and Zod schema mirrors must be updated too (see `.claude/rules/frontend-configuration.md`)

### 7. Kickoff summary

After the worktree is created, report:

```
Feature kickoff complete:
  Branch:    feature/BDP-123-short-slug (from origin/develop @ <sha>)
  Jira:      BDP-123 → In Progress (https://bytedesk.atlassian.net/browse/BDP-123)
  Worktree:  .claude/worktrees/BDP-123-short-slug
  Next:      cd .claude/worktrees/BDP-123-short-slug
```

## After Kickoff

Continue implementation from inside the feature worktree. Run `/bytedesk-pr-ready` from inside that worktree when implementation and verification are complete. Never merge locally to `develop` — PRs gate the `gateway` / `web` / `helm-chart` CI checks the project rules require.

## After Merge — Cleanup

Once the PR merges on GitHub, run `node scripts/dev/workflow.mjs cleanup <worktree-name>` from the canonical checkout. The operator handles localDev reset and branch/worktree safety checks.
