---
name: bytedesk-session-start
description: Session start briefing for ByteDesk Platform — surfaces In Progress Jira work, current git state, open PRs, and the single most important next action. Invoke at the start of any coding session, or when you say "what was I working on?", "where did I leave off?", "morning standup", "catch me up", "get me up to speed", "session start", or any variant of "I'm back, what's next?" Gives a concise brief so you can start coding immediately without digging through Jira, git, or GitHub manually.
user-invokable: true
allowed-tools:
  - Bash
  - mcp__atlassian__searchJiraIssuesUsingJql
  - mcp__atlassian__getJiraIssue
  - mcp__plugin_devops_github__list_pull_requests
  - mcp__plugin_devops_github__get_pull_request_status
---

## Mission

Get from zero context to "here's exactly what to do next" in under 60 seconds. No walls of text, no questions — just the brief.

## Gather in parallel

Run these simultaneously:

**0 — Worktree operator summary + laptop hygiene:**
```bash
scripts/dev/workflow.mjs status --no-fetch
scripts/dev/workflow.mjs doctor
```

**1 — Git state:**
```bash
git rev-parse --path-format=absolute --show-toplevel
git rev-parse --path-format=absolute --git-common-dir
git branch --show-current
git status --short | head -10
git log --oneline origin/develop..HEAD | head -5
git stash list | head -3
git worktree list --porcelain | sed -n '1,40p'
```

**2 — Jira In Progress** (`mcp__atlassian__searchJiraIssuesUsingJql`):
```
JQL: project = BDP AND status = "In Progress" ORDER BY updated DESC
maxResults: 5
```

**3 — Open PRs** (`mcp__plugin_devops_github__list_pull_requests`):
```
owner: ByteDeskAI, repo: bytedesk-platform, state: open
```
For each PR, also check its CI status with `mcp__plugin_devops_github__get_pull_request_status`.

## The brief

Format as a tight, scannable block — target under 20 lines total:

```
## Session — {DATE}

### Branch
Worktree: {canonical | .claude/worktrees/<name>}
{branch} [{BDP-N if extractable from branch name}]
{N} uncommitted changes | {N} commits ahead of develop
{stash count if >0: "⚠ {N} stashed"}

### Jira In Progress
- BDP-N: {summary} (updated {X} days ago)

### Open PRs
- #{number}: {title} — {CI: ✓ passing | ✗ failing: {check} | ○ pending}

### Next Action
→ {One specific thing. See derivation rules below.}
```

## Deriving the next action

Pick the highest-priority signal from this ordered list:

| Signal | Next action |
|---|---|
| `develop-remote` drift or missing localDev root | "Sync runtime: `scripts/dev/workflow.mjs reset-localdev --services web`" |
| PR with failing CI | "Fix CI on #{PR}: {failing check name}" |
| PR with passing CI + no review requested | "PR #{PR} is green — merge it and close {BDP-N}" |
| On canonical checkout with uncommitted changes | "Move or stash canonical checkout changes before feature work; do not implement on `develop`/`main`" |
| On canonical checkout or `develop`/`main` with In Progress Jira item | "Create or enter a worktree for {BDP-N}: `scripts/dev/workflow.mjs new BDP-N-short-slug`" |
| Uncommitted changes on a feature branch | "Commit your changes on {branch} — run `/bytedesk-software-engineer commit`" |
| In Progress Jira item, no matching branch | "Resume {BDP-N}: run `/bytedesk-software-engineer resume`" |
| Stash entries exist | "Clear your stash: `git stash list` to review" |
| No In Progress items, clean state | "Nothing active — run `/bytedesk-software-engineer brainstorm` to start something new" |
| Default | "Continue {branch}: run `/bytedesk-software-engineer resume`" |

One next action only. If multiple signals, show the highest-priority one and note the others in a single "Also:" line.

Classify the checkout as canonical when `git rev-parse --show-toplevel` equals the parent directory of `git rev-parse --git-common-dir`; otherwise show the relative worktree path, preferably `.claude/worktrees/<name>`.

## Tone

Terse. This is a dashboard, not a report. No markdown headers beyond what's in the template. No "it looks like" or "I noticed". State facts, state the action.