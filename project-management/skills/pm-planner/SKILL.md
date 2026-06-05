---
name: pm-planner
description: PM planner — takes one sentence describing what you want, immediately enters planning mode, reads the codebase to reason about the work, then presents a breakdown (what it will do + tickets) for approval before creating anything. No interview. No questions unless genuinely necessary.
user-invokable: true
argument-hint: "[one sentence: what you want to build or fix]"
allowed-tools: EnterPlanMode, ExitPlanMode, AskUserQuestion, Bash, Read, Glob, Grep, mcp__pm__pm_issue_create, mcp__pm__pm_issue_update, mcp__pm__pm_status, mcp__pm__pm_issue_list, mcp__pm__pm_doc_list, mcp__pm__pm_search
---

Take one sentence describing the goal. If the user provided an argument, use it. If not, ask once with plain text — no AskUserQuestion, no options, just: "What do you want to do?"

Then immediately call **EnterPlanMode** and do the work.

---

## Inside plan mode — do all of this before calling ExitPlanMode

**1. Read the codebase**

Use Bash, Glob, Read, Grep to understand the current state of the relevant code:
- Find files this request will touch
- Read the key ones
- Check existing tickets: pm_issue_list
- Check git log: `git log --oneline -10`
- Get sprint context: pm_status

**2. Draft the plan**

Write a plan file with exactly three parts:

**WHAT I'M DOING**
3–6 sentences. Specific: which files change, what gets added, what existing behavior changes, any tradeoffs. No vague language.

**TICKETS**
List every ticket. Each needs:
- Specific imperative title ("Add X to Y" not "Work on X")
- Type: task / bug / epic (infer this — do not ask)
- Priority: high / medium / low (infer this — do not ask)
- Description: implementation-ready — enough detail that Claude can execute it without further clarification

Use an epic + tasks only if the work genuinely requires multiple independent sessions. One focused change = one task.

**ASSUMPTIONS**
Any ambiguity you resolved by inference. Give the user one clear way to redirect if you got it wrong.

**3. Call ExitPlanMode**

---

## After approval — create tickets

Get current user: `git config user.name` via Bash
Check for active sprint in pm_status result

Create epic first if needed, capture ID. Then create each task. No story points. No assignee question — use the git user name for all tickets.

Print a final summary and recommend which ticket to start first.

---

## The one rule

**Do not ask the user any questions** during planning unless something is genuinely ambiguous that cannot be resolved by reading the code. If you find yourself about to ask about issue type, scope, priority, or assignee — don't. Infer it.
