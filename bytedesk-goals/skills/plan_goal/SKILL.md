---
name: plan_goal
description: Run a planning session that turns a fuzzy intent into a self-contained, goal-based spec saved at docs/goals/<theme>.md, then exits plan mode by handing off a runnable `/goal docs/goals/<theme>.md`. Use when the user wants to capture/spec a piece of work as a runnable goal artifact, hand work to a fresh session, or says "plan a goal", "make a goal doc", "spec this as a goal", or "/plan_goal".
user-invokable: true
argument-hint: "[short description of the work to plan as a goal]"
---

# Plan Goal

Turn a fuzzy intent into a **self-contained, goal-based spec** that a FRESH session — with **no memory of this planning conversation** — can execute end-to-end. The deliverable is a file at `docs/goals/<goal-themed-name>.md`, and the session ends by exiting plan mode with a runnable `/goal docs/goals/<goal-themed-name>.md` handoff.

## What this skill is (and is not)

- This is a **planning/spec** skill. You research, interview, and draft. You **do NOT implement the goal** here — implementation happens later when the user runs `/goal <path>` in a fresh context.
- Stay read-only during planning (research + questions). The **only** thing you write is the goal artifact itself (the planning deliverable).

## Process

1. **Clarify intent** with `AskUserQuestion` (don't guess). Pin down:
   - The **objective** in one sentence.
   - **Done = ?** — concrete, *verifiable* success criteria (a command, an observable state, a shipped artifact), not "make it work".
   - **Scope boundaries** — what's explicitly in vs out.
   - **Constraints** — hard requirements, things never to do, deadlines.
   - If the user already described it well, confirm rather than re-ask.
2. **Research** the codebase/systems so the artifact carries the **hard-won context** a fresh session would otherwise burn time re-deriving: exact file paths, commands, prior art, gotchas, current state. Use Explore/grep/Read; check relevant memory files, ADRs, and Jira if applicable.
3. **Draft** the goal doc using the template below.
4. **Write** it to `docs/goals/<goal-themed-name>.md` (create `docs/goals/` if missing). Name it after the *theme/outcome* in kebab-case (e.g. `elena-autonomous-deploy.md`), not after a ticket number.
5. **If the intent is several goals**, write one self-contained doc per goal (step 4 each) **and** a manifest at `docs/goals/<theme>.plan.json` (schema below) capturing identity, ordering, and lane hints. See [[run_goals]] for how the manifest is executed.
6. **Exit plan mode** (`ExitPlanMode`) with a short summary whose final line is the literal handoff:
   - single goal → `/goal docs/goals/<goal-themed-name>.md`
   - multiple goals → `/run_goals docs/goals/<theme>.plan.json`

## Manifest (multi-goal plans only)

Write alongside the goal docs at `docs/goals/<theme>.plan.json`. It does **not** restate success criteria — each doc owns those; the manifest only carries identity, dependency order, and lane hints consumed by [[run_goals]].

```jsonc
{
  "plan": "<theme-slug>",
  "created": "<YYYY-MM-DD>",
  "jiraEpicKey": "<BDP-N>",              // optional; set by /plan_epic when this plan delivers an Epic
  "integration": {                       // optional; autonomous landing for parallel batches
    "autoMergeTo": "develop",            // omit/empty => stop at green (human merges). Set => auto-merge ONLY through a green gate.
    "gate": "scripts/testing/local-test.sh pr-ready"  // full suite run once on the integrated result
  },
  "goals": [
    {
      "id": "<kebab-id>",                  // unique; referenced by dependsOn
      "doc": "docs/goals/<name>.md",       // self-contained goal doc
      "title": "<short title>",
      "dependsOn": ["<id>", "..."],        // ids that must LAND (merge to base) before this STARTS; this goal branches from the updated base
      "mode": "sequential",                // "sequential" (default, safe) | "parallel" (opt-in worktree fan-out)
      "needsHumanGate": false,             // true if it needs interactive approval / deploy / merge mid-run (forces sequential)
      "touches": ["<path>", "..."],        // paths it writes; overlap => can't share a parallel batch
      "jiraTaskKey": "<BDP-N>"             // optional; set by /plan_epic, synced via bytedesk-jira-task
    }
  ]
}
```

Defaults and intent:
- **`mode` defaults to `sequential`** — only set `"parallel"` for goals you've vetted as genuinely independent. [[run_goals]] runs sequential goals in-session (full `/goal` fidelity, each lands before the next) and converges parallel goals at an integration gate before anything lands.
- **`dependsOn` is a LAND-dependency:** a dependent goal does not start until its deps have **merged to the base**, then it branches from the updated base. So if goal B needs goal A's code, declare `dependsOn: ["A"]` — `run_goals` will land A before starting B. Use it whenever a goal builds on another's changes, not just for loose ordering.
- `needsHumanGate: true` for any goal whose Constraints include human approval/merge/deploy (it forces sequential); `touches` to the top-level paths each goal writes.
- **`integration.autoMergeTo`** turns on autonomous merge-to-`develop` for parallel batches — but only ever through a green integration gate (combine branches + run the full suite once). Leave it unset to stop at "green — PRs ready" for a human merge.
- Leave `jiraEpicKey`/`jiraTaskKey` empty here — [[plan_epic]] populates them when the plan is epic-backed.

## The artifact MUST be self-contained

A fresh context has none of this conversation. The doc must stand on its own:
- State the goal and success criteria up front.
- Carry the context needed to act: paths, commands, credentials *locations* (never secret values), system topology, the "why", and what's already done so the new session doesn't redo it.
- Point to durable sources it can read for more (memory files, ADRs, Jira keys, other docs) instead of inlining everything.
- Prefer "don't re-derive — here's what's already true" framing over open-ended exploration.

## Goal doc template

```markdown
# Goal: <one-line outcome> [(<ticket key> if any)]

> Self-contained goal statement for a fresh session. Clear context, then run this.

## GOAL
<2-4 sentences: the objective and the single clear outcome.>

**Success criteria (verifiable):**
<Concrete, checkable conditions. Ideally an exact command/observable state and a
real end-to-end verification, e.g. "ship version X and confirm Y".>

## Why / the problem to solve
<The motivation + the specific friction or root cause this goal addresses.>

## Context already in place (don't re-derive)
- <Proven mechanisms, exact paths, commands, prior art.>
- <Current state of the system relevant to the goal.>
- <Read-first pointers: memory files, ADRs, Jira keys, docs.>
- <If goal touches `src/ByteDesk.*` or `infra/k8s/**`: read `docs/architecture/anchors.yaml` partition + plan `workspace.dsl` co-commit via `/bytedesk-architecture-sync`.>

## Key files / commands
- <path> — <what it is>
- `<command>` — <what it does>

## Constraints
- <Hard requirements, things never to do, deadlines, security/least-privilege.>

## Already done (do not redo)
- <What's shipped/merged/verified so far.>
- <The remaining gap this goal closes.>
```

## Quality bar

- **Verifiable success criteria.** If you can't name how the fresh session proves it's done, the spec isn't ready — ask more.
- **No buried secrets.** Reference where credentials live (Infisical/k8s secret/etc.), never the values.
- **Right altitude.** Enough context to act without this conversation; link out for the rest rather than dumping everything.
- **One goal per file.** If the intent is several goals, produce one self-contained file each, plus the `docs/goals/<theme>.plan.json` manifest that wires them together for [[run_goals]].
- **Honest lane hints.** In the manifest, set `dependsOn`, `needsHumanGate`, and `touches` truthfully — they are what lets [[run_goals]] parallelize safely vs. serialize / run in-session. A wrong `touches` causes write collisions; a missing `needsHumanGate` sends an approval-bound goal to a headless subagent that will stall.

## Ending the session

On `ExitPlanMode`, the plan you present must end with the exact runnable handoff so the user can clear context and run it:

- **Single goal:**
  ```
  /goal docs/goals/<goal-themed-name>.md
  ```
- **Multiple goals:**
  ```
  /run_goals docs/goals/<theme>.plan.json
  ```

Do not start implementing — the planning session is complete once the artifact(s) and (for multi-goal plans) the manifest are written and the handoff is presented.

When invoked via **`/goals plan <intent>`**, `/goals` regenerates the goal board (`docs/goals/README.md`) on return so the new artifact shows immediately — this skill just writes the artifact and presents the handoff (ADR-0059).