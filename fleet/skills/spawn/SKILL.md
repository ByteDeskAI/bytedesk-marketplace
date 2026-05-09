---
name: fleet-spawn
description: Spawn one or many parallel Claude agents on Jira tickets, with full-auto mode and Jira-aware prompt construction. Single-ticket form replaces a manual bytedesk-feature-start when you already know the ticket; multi-ticket form fires N sessions in parallel ("kick off the whole sprint"). Use when the user says "fleet spawn", "/fleet-spawn", "kick off these tickets", "spawn agents for", "/fleet-spawn BDP-N BDP-M", or any phrasing about launching one or more sessions from existing Jira tickets.
user-invokable: true
argument-hint: "<BDP-N> [BDP-M ...]    # one or more existing Jira ticket keys"
allowed-tools:
  - Bash
  - Read
  - Write
  - mcp__plugin_atlassian_atlassian__searchJiraIssuesUsingJql
  - mcp__plugin_atlassian_atlassian__getJiraIssue
  - mcp__plugin_atlassian_atlassian__getTransitionsForJiraIssue
  - mcp__plugin_atlassian_atlassian__transitionJiraIssue
  - mcp__plugin_atlassian_atlassian__addCommentToJiraIssue
---

## What this skill does

Spawns one or more sessions in the multi-session command center, with each session's prompt auto-built from its Jira ticket description. Every spawn:

1. Confirms the ticket exists and is not already Done.
2. Transitions it to **In Progress** if it isn't already.
3. Writes a self-contained prompt to `/tmp/<TICKET>-prompt.txt` (ticket context + applicable rule files + safety rails + exit condition).
4. Calls `spawn-claude-feature <TICKET> <slug> --prompt-file /tmp/<TICKET>-prompt.txt --full-auto`.
5. Reports the spawned session(s) in chat with the dashboard link.

For new feature work without a ticket yet, use `/bytedesk-feature-start` instead — it handles ticket creation. This skill assumes the tickets already exist.

## Steps

For each ticket key in the arguments:

1. **Fetch the ticket** with `mcp__plugin_atlassian_atlassian__getJiraIssue` (cloudId `bytedesk.atlassian.net`, format `markdown`). If status is `Done`, refuse with a clear message — don't re-spawn closed work.
2. **Pick a slug** — derive a short lowercase-kebab from the ticket summary, max ~5 words. If the user supplied a custom slug after the ticket key as `BDP-N=my-slug`, use that instead.
3. **Transition to In Progress** if not already (use `getTransitionsForJiraIssue` to find the transition id; usually `21` for BDP).
4. **Build the prompt** at `/tmp/<TICKET>-prompt.txt` using the **Prompt template** below. Pull in the ticket's description verbatim.
5. **Spawn** with: `spawn-claude-feature <TICKET> <TICKET>-<slug> --prompt-file /tmp/<TICKET>-prompt.txt --full-auto`.
6. After all spawns, report a single block listing every spawned session with its tmux name, branch, and Jira link. End with the dashboard URL and a `/fleet` suggestion.

If multiple tickets are passed, do them in parallel where possible: fetch tickets and write prompt files concurrently, then sequence the spawns one after another (each spawn is fast — <2s — and sequencing them avoids the rare race on tmux session creation).

## Prompt template

```
You are picking up Jira ticket <TICKET> in a fresh worktree on branch feature/<TICKET>-<slug>.

Read first:
  1. https://bytedesk.atlassian.net/browse/<TICKET>
     (use mcp__plugin_atlassian_atlassian__getJiraIssue with cloudId=bytedesk.atlassian.net)
  2. The applicable rule files in .claude/rules/ for this work-type:
     <list rules based on summary keywords: frontend.md, backend.md, database.md, kubernetes.md, etc>
  3. Any ADRs in docs/architecture/adr/ relevant to the area being changed.

Ticket description (verbatim):
<insert ticket description from getJiraIssue>

Hard constraints (full-auto safety):
  - Never `git push --force`.
  - Never modify CI workflows or repository settings.
  - Never touch sibling worktrees in .claude/worktrees/.
  - Stop and post a one-paragraph plan in this terminal BEFORE writing code.
    Wait 30s for the user to intervene; if no intervention, proceed.
  - Open the PR with `/bytedesk-pr-ready` when the work is green.
  - When merged: comment on <TICKET> with the PR link + commit SHA, then transition to Done.

Exit when: PR is merged, Jira is Done, you've left a brief lessons summary in the chat.
```

## Output format

```
Spawned 3 sessions:

  BDP-360 · feature/BDP-360-project-dns-host-ui    · https://bytedesk.atlassian.net/browse/BDP-360
  BDP-361 · feature/BDP-361-deploy-tab-redesign     · https://bytedesk.atlassian.net/browse/BDP-361
  BDP-362 · feature/BDP-362-virtualized-file-tree   · https://bytedesk.atlassian.net/browse/BDP-362

Dashboard: http://127.0.0.1:7681/
Status:    /fleet
```

If only one ticket was spawned, drop the count line; just print the single session.

## Constraints

- One ticket = one session. Do not bundle multiple tickets into a single spawn.
- If the user passes a ticket that doesn't exist, say so explicitly with the bad key — don't silently skip.
- If a ticket fails to spawn (e.g. tmux name collision because a session is already running for that ticket), continue with the others and report the failure at the end.
- Do not edit the ticket description, only read it.

## Examples

```
/fleet-spawn BDP-360
/fleet-spawn BDP-360 BDP-361 BDP-362
/fleet-spawn BDP-360=dns-host-ui                    # custom slug for one ticket
/fleet-spawn BDP-360 BDP-361=deploy-tab BDP-362     # mix of default and custom
```
