---
name: plan_epic
description: Plan a multi-task initiative as a Jira Epic whose child Tasks are each a runnable goal. Confirms the epic + task breakdown with the user, creates the Epic and child Tasks in Jira (BDP) via the bytedesk-jira-task skill, writes one self-contained goal doc per task (plan_goal template), and emits a docs/goals/<theme>.plan.json manifest wired with jiraEpicKey + per-goal jiraTaskKey, then hands off /run_goals. Use when the user says "plan an epic", "/plan_epic", "spec this initiative", "break this into tasks and goals", or describes a body of work too big for one goal.
user-invokable: true
argument-hint: "[short description of the initiative / epic]"
---

# Plan Epic

The top tier of the planning pipeline. Turns a multi-task initiative into a
**Jira Epic + child Tasks**, where **each Task is a runnable goal** that
[[run_goals]] executes. Reuses [[plan_goal]] for the per-task goal docs and
[[bytedesk-jira-task]] for all Jira writes.

```
plan_epic <intent>
  → Jira Epic (BDP) + child Tasks (one per unit of work)
  → one goal doc per Task (plan_goal template)
  → manifest docs/goals/<theme>.plan.json  (jiraEpicKey + per-goal jiraTaskKey + deps + mode)
  → handoff: /run_goals docs/goals/<theme>.plan.json
```

## What this skill is (and is not)
- A **planning** skill. You research, decompose, confirm, then create Jira scaffolding + goal docs. You do **NOT** implement the work — that happens when the user runs `/run_goals`.
- Read-only during research. The only **writes** are: Jira issues (after confirmation), the goal docs, and the manifest.

## Process

1. **Clarify the initiative** with `AskUserQuestion` (don't guess):
   - The **epic objective** in one sentence and its definition of done.
   - The **task breakdown** — the units of work, each of which becomes one Task = one goal = one PR. Keep tasks independently shippable where possible.
   - **Dependencies** between tasks, and which (if any) are safe to run in **parallel** vs **sequential** (default sequential).
   - **Scope** (in/out) and **constraints** (deadlines, human gates, things never to do).
2. **Research** the codebase/Jira/Confluence so each goal doc carries hard-won context (paths, commands, prior art, current state). Check existing Jira so you don't duplicate an Epic/Task that already exists.
3. **Confirm the breakdown BEFORE creating anything in Jira.** Present the proposed Epic + Task list (titles + one-line each + deps + mode) and get explicit approval — creating Jira issues is a real, externally-visible side effect.
4. **Create Jira scaffolding** via [[bytedesk-jira-task]]: create the **Epic** in `BDP`, then each **Task** with `parent` set to the Epic. Capture every returned key.
5. **Write one goal doc per Task** using the [[plan_goal]] template at `docs/goals/<name>.md`. Each doc must be self-contained (a fresh session/subagent runs it with no other context) and carry **verifiable success criteria**. Put the Jira key in the doc title.
6. **Write the manifest** `docs/goals/<theme>.plan.json` with `jiraEpicKey`, and per goal: `id`, `doc`, `title`, `dependsOn`, `mode` (default `sequential`; `parallel` only for vetted-independent tasks), `needsHumanGate`, `touches`, `jiraTaskKey`. (Schema lives in [[plan_goal]] / [[run_goals]].)
7. **Exit plan mode** (`ExitPlanMode`) with a summary whose final line is the handoff:
   ```
   /run_goals docs/goals/<theme>.plan.json
   ```

## How the tiers fit
- **goals** is the front door: `/goals plan <intent>` routes here (multi-task) or to plan_goal (single), then regenerates the goal board on return (ADR-0059). This skill just builds the scaffolding + artifacts and presents the `/run_goals` handoff.
- **plan_epic** (this) owns the Jira Epic/Task scaffolding + decomposition.
- **plan_goal** is the per-task building block (one self-contained goal doc). Don't duplicate its doc logic — reuse the template.
- **run_goals** executes: sequential goals in-session (real `/goal`), `parallel` goals in isolated worktrees converging at an integration gate, and syncs each Task's Jira status (In Progress on dispatch, Done on land) when `jiraTaskKey` is set. Execution worktrees are owned by the **worktree-operator** (`scripts/dev/workflow.mjs`, ADR-0058 / `.claude/rules/worktree-lifecycle.md`) — planning never touches worktrees.

## Quality bar
- **Confirm before Jira.** Never create the Epic/Tasks before the user approves the breakdown.
- **One Task = one goal = one PR.** If a task can't be a self-contained goal with verifiable success criteria, decompose further or merge it.
- **Verifiable success criteria** in every goal doc — same bar as plan_goal.
- **Honest manifest hints** — `dependsOn`, `mode`, `needsHumanGate`, `touches` drive safe execution (see plan_goal's guidance). Default `sequential`; reserve `parallel` for genuinely independent tasks.
- **No buried secrets.** Reference where credentials live, never values.
- **Reuse, don't rebuild.** Jira writes via bytedesk-jira-task; goal docs via the plan_goal template.

## Constraints
- Creating Jira issues is a real side effect — gate it behind explicit user confirmation of the breakdown.
- Do not implement; the epic plan is complete once the Epic + Tasks exist, the goal docs and manifest are written, and the `/run_goals` handoff is presented.
- Reserved actions (merge/deploy) stay with the human unless a goal doc explicitly authorizes them — run_goals + its integration gate enforce this at execution time.
