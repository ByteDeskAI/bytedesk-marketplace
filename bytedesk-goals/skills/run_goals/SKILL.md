---
name: run_goals
description: >-
  Execute goal batches through run-goals — validate manifests,
  then drain the plan sequentially inline via /goal handoffs (exit 2 until each
  goal completes). Orchestrates docs/goals/*.plan.json with land-gated dependsOn,
  proof gate (update_goal or record/proof), and integration gate for parallel
  subagent batches; never implements goal docs inline. Syncs Jira via
  bytedesk-jira-task when goals carry jiraTaskKey. Use for "run goals",
  "/run_goals", "execute the plan", a .plan.json manifest, or a single goal doc.
user-invokable: true
argument-hint: "[docs/goals/<theme>.plan.json | <goal.md>]"
allowed-tools:
  - Bash
  - Read
  - Grep
  - Agent
  - AskUserQuestion
  - mcp__atlassian__searchJiraIssuesUsingJql
  - mcp__atlassian__getJiraIssue
  - mcp__atlassian__editJiraIssue
  - mcp__atlassian__transitionJiraIssue
  - mcp__atlassian__getTransitionsForJiraIssue
  - mcp__atlassian__addCommentToJiraIssue
---

# Run Goals

Execute a batch of goals planned by [[plan_goal]]. Each goal is a self-contained
doc at `docs/goals/<name>.md` carrying its own **verifiable success criteria**;
this skill orchestrates running them in the right order and reports PASS/FAIL.

## Inputs

- **A manifest** `docs/goals/<theme>.plan.json` (preferred — see schema below), or
- **A single goal doc** `docs/goals/<name>.md` — **MUST** execute through `/goal`
  via `run-goals run-one` (emits inline handoff); skip the manifest
  orchestration below but not the Goal Execution Contract.

## Goal Execution Contract (NON-NEGOTIABLE)

`run_goals` **orchestrates** — it does **not** implement goal docs inline.

Before marking any goal PASS:

1. **Validate** the manifest (when using a plan):
   `run-goals validate docs/goals/<theme>.plan.json`
2. **Execute each goal through `/goal` inline** — the mechanical executor always
   emits a handoff (exit 2) and halts until you invoke the printed prompt:
   - Single goal: `run-goals run-one --id <goal-id> --doc <doc-path>`
   - Manifest loop: `run-goals run-manifest <manifest.plan.json>`
     → invoke `/goal` from the JSON prompt → on PASS run the printed `continueAfter.command`
     (adds `--completed <id>` for each finished goal until manifest exits 0).
3. **Proof gate** — accept PASS only when:
   - `update_goal(completed: true)` with per-criterion evidence (primary), **or**
   - optional sentinel: `run-goals record --id <goal-id>` then
     `proof --id` exits 0.
4. **Land** (sequential default): `scripts/dev/workflow.mjs land feature/<goal-id>`
   before the next goal whose deps require merged code.

**FORBIDDEN:** summarizing a goal doc and implementing from memory without step 2.  
**FORBIDDEN:** marking PASS from tests/PR alone without the proof gate in step 3.

### Mechanical executor (`run-goals`)

| Verb | Purpose |
|---|---|
| `validate <manifest>` | DAG + doc existence check |
| `run-one --id --doc` | Emit inline `/goal` handoff for one goal (exit 2) |
| `run-manifest <manifest> [--completed id,id]` | Next sequential handoff, or exit 0 when done |
| `status --id` | Inline completion sentinel status |
| `proof --id` | Exit 0 only when sentinel says succeeded |
| `record --id [--exit-code N]` | Write completion sentinel after inline `/goal` |
| `handoff --id --doc` | Alias for `run-one` |

Manifest loop (preferred):

```bash
run-goals validate docs/goals/<theme>.plan.json
run-goals run-manifest docs/goals/<theme>.plan.json
# exit 2 → invoke printed /goal prompt → land → re-run continueAfter.command
# exit 0 → manifest complete
```

If `/goal` is unavailable as a slash command, **read and follow the [[goal]] skill
verbatim** (`update_goal` loop). That *is* `/goal` — not a license to skip it.

## Manifest schema (`docs/goals/<theme>.plan.json`)

```jsonc
{
  "plan": "proactive-goal-engine",        // theme slug
  "created": "2026-05-22",
  "jiraEpicKey": "BDP-947",               // optional; set by /plan_epic. Epic this plan delivers.
  "integration": {                        // optional; controls autonomous landing after a parallel batch
    "autoMergeTo": "develop",             // omit/empty => STOP at green (default). Set => auto-merge to this branch ONLY through a green gate.
    "gate": "scripts/testing/local-test.sh pr-ready"  // full suite run once on the integrated result; default if omitted
  },
  "goals": [
    {
      "id": "cadence",                      // unique kebab id, referenced by dependsOn
      "doc": "docs/goals/agent-goal-cadence.md",  // self-contained goal doc (has Success criteria)
      "title": "BDP-949 cadence engine",
      "dependsOn": [],                      // ids that must LAND (merge to base) before this STARTS; this goal branches from the updated base
      "mode": "sequential",                 // "sequential" (default) | "parallel" (opt-in worktree fan-out)
      "needsHumanGate": false,              // true => always in-session (forces sequential)
      "touches": ["plugins/bytedesk-team-plugin"], // paths it writes; overlap => can't be in the same parallel batch
      "jiraTaskKey": "BDP-949"              // optional; transitions synced via bytedesk-jira-task
    }
  ]
}
```

The manifest does **not** restate success criteria — each `doc` owns them. It
carries identity, ordering, execution-mode, and (optionally) Jira keys.

**Mode default is `sequential`** and that is the safe path: parallelism is opt-in
per goal, and even parallel goals never land independently — they converge at the
integration gate. `needsHumanGate: true` forces sequential regardless of `mode`.

## Execution

### 1. Load + validate (do this before running anything)
- Parse the manifest. Confirm every `doc` path exists and is readable.
- Build the dependency DAG from `dependsOn`. **Reject cycles** and unknown ids — report and stop.
- Create a TaskCreate entry per goal so progress is visible; set blockedBy from `dependsOn`.

#### Dependencies LAND before dependents START
`dependsOn` is a **land**-dependency, not a pass-dependency: a goal does not start until **every** dep has **landed on the base branch** (merged to `develop`, not merely PASS-in-isolation). The dependent's worktree is then created from the **updated** base, so it actually builds on its deps' code. This is why a dep that "passed" but isn't merged cannot unblock anything.

Execute as **land-gated levels**, looping until all goals are done:
1. **Startable set** = not-yet-done goals whose `dependsOn` have **all landed** on the base (a no-dep goal is startable immediately). If the set is empty but goals remain, you're blocked on an un-landed dep — see resumability below.
2. Before creating that set's worktrees, `git -C <canonical> fetch origin develop` so they branch from a base containing everything landed so far.
3. Run the set: parallel-mode goals fan out + converge at the integration gate (§4) and land **together**; sequential goals run in-session and land **one at a time** (§2). Within the set, `touches` overlap forces serial.
4. After the set lands, its goals are "landed" — recompute the startable set (new goals unlock because their deps are now on the base) and repeat.

**Resumability:** if `integration.autoMergeTo` is unset, a level stops at "green — PRs ready" and dependents stay blocked until **you merge** those PRs. `run_goals` is idempotent — re-invoke it (or it resumes) once the deps are on `develop`; it skips goals already landed (detect via the base branch containing them / Jira Done) and continues with the newly-unblocked level.

### 1b. Execute through `run-goals` (before §2 lane selection)

After §1 validation, **do not implement goals yourself**. Drive execution:

1. `run-goals validate <manifest>` (or confirm `--doc` exists for a single goal).
2. `run-goals run-manifest <manifest>` — exit 2 halts with the next
   inline `/goal` handoff; invoke it, `update_goal(completed: true)`, optionally `record --id`,
   then `workflow.mjs land feature/<goal-id>` when the doc requires it.
3. Re-run the printed `continueAfter.command` until `run-manifest` exits 0.

### 2. Pick a lane per goal
- **Sequential inline `/goal` (DEFAULT).** `run-goals` always emits in-session handoffs.
  Each goal gets a real `/goal` Stop-hook loop in this session — not implementation from memory.
  **Land before the next goal whose deps require merged code.** Always used when
  `needsHumanGate: true`, or when the goal's Constraints reserve interactive approval/deploy/merge.
- **Parallel worktree fan-out (OPT-IN).** Only for goals explicitly marked `"mode": "parallel"`.
  Use background `Agent` subagents (§3) — not `run-goals`, which is sequential-only.
  Parallel goals **never land on their own** — they converge at the **integration gate (§4)**.

When in doubt, sequential. Parallelism is a wall-clock optimization for vetted-independent goals, not the default.

### Worktree isolation (via the worktree-operator)
All worktree lifecycle goes through the **worktree-operator** (`scripts/dev/workflow.mjs`, ADR-0058) — never `worktree.sh`, raw `git worktree`/`git branch -D`, or `gh pr merge` directly, and never the Agent tool's generic `isolation: "worktree"` (it bypasses branch conventions + shared-state symlinks). Per parallel goal:
1. **Create from the up-to-date base:** `scripts/dev/workflow.mjs new <goal-id>` (the operator fetches `develop` first; default base `origin/develop`) → makes `.claude/worktrees/<goal-id>` on branch `feature/<goal-id>`, symlinked to shared state. Because dependents only start after their deps have **landed** (§1), the worktree already contains every dep's code. Resolve the absolute path `"<canonical>/.claude/worktrees/<goal-id>"`.
2. **Dispatch scoped:** the subagent prompt must say *"ALL your work happens in `<abs worktree path>` — start every command by ensuring you are in that directory; never touch the canonical checkout or another goal's worktree."* Do **not** pass Agent `isolation`.
3. **Develop, don't land:** on PASS the subagent pushes `feature/<goal-id>` and opens its PR via `scripts/dev/workflow.mjs ship --message "<BDP-N: summary>"` — `ship` pushes + opens a PR but does **NOT merge**. Each goal is verified only *in isolation*; landing is the integration gate's job.
4. **Clean up:** after the batch lands (or is abandoned), `scripts/dev/workflow.mjs cleanup <goal-id>` (`--force` only to discard intentional scratch) — this removes the worktree **and** its branch and resets localDev if that worktree was the source mount.

### 3. Parallel lane (opt-in `mode: "parallel"` goals only)

`run-goals` does not fan out parallel goals. For parallel-mode goals in a level,
dispatch background `Agent` subagents. Each handoff from `run-one` injects
worktree-operator grounding — subagent prompts must repeat cwd, `feature/<id>`, and
`workflow.mjs` verbs; agents must not implement from canonical `develop`/`main`.

Each parallel subagent prompt MUST:

> Read the [[goal]] skill. Treat the goal doc as a `/goal` objective. Self-verify every Success criterion with command evidence. Run `run-goals proof --id <id>` before reporting PASS (or write equivalent sentinel). `ship` but do **not** `land`.

`RESULT: PASS` alone is **insufficient** without `proof --id` succeeding.

### 4. Integration gate (parallel batches only — the safe path to auto-merge)
Parallel goals are each verified **only in isolation**; merging them is the only point where their *combination* is tested. `touches` (path overlap) catches obvious file collisions but **not** semantic ones (two migrations, two version bumps, two consumer registrations, lockfile churn). So "all worktrees complete" is **not** sufficient to land — the gate is. Once every parallel goal in the batch is PASS (branches pushed, PRs open):

0. **Concurrency sanity:** before dispatching a wide batch, run:
   ```bash
   agent-concurrency-plan --agents <N> --repo platform
   ```
   If the plan says `chunked`, split the batch. When agents fail with
   rate-limit/quota noise, re-dispatch once with failure context; repeated
   failures move to the in-session lane.
1. **Fresh base:** create an integration worktree from the up-to-date base via the operator: `scripts/dev/workflow.mjs new <plan>-integration`.
2. **Combine:** `cd` into it and merge each **PASSED** branch one at a time (`git merge --no-ff feature/<goal-id>`). A non-trivial conflict is a real integration problem the isolated runs couldn't see — **abort the merge, STOP, surface it**; nothing lands.
3. **Test the combination once:** run `integration.gate` (default `scripts/testing/local-test.sh pr-ready`) on the integrated result. This is the only run that proves the goals work *together*.
4. **Land — decided by `integration.autoMergeTo`:**
   - **Not set (DEFAULT):** report "integration green — N PRs ready" and stop; the user merges.
   - **Set (e.g. `"develop"`) AND gate green:** auto-land. Merge each PASSED branch in listed order via the operator: `scripts/dev/workflow.mjs land feature/<goal-id> [feature/...]` (the explicit merge step); because the gate already proved the combination, these apply cleanly — if `land` reports a conflict, STOP. `land` also advances the develop-remote localDev mirror to the merged code (best-effort roll; pass `--no-roll` to skip the pod restart). Then confirm the target branch contains every merge. PRs stay the audit trail; Jira tasks transition to **Done** (§6) on land.
   - **Set BUT gate red:** **nothing lands.** Report the likely culprit (re-run the gate after dropping the last-merged branch to bisect if cheap), leave PRs open, stop.
5. **Clean up** all feature worktrees + the integration worktree (each `scripts/dev/workflow.mjs cleanup <name>`, which also removes the branch), per § Worktree isolation step 4.

**Integration-branch exception:** if the integration branch itself contains
merge commits with conflict resolutions, do **not** run `workflow.mjs ship`,
`workflow.mjs land`, or `git rebase` on that branch. Invoke
`bytedesk-integration-branch-operator`, push the integration branch as-is, merge
the PR with a merge commit, then run `sync-develop-runtime`, `reset-localdev`,
and cleanup. This preserves resolutions that a rebase would replay.

Hard rules: the gate (steps 1–3) is **mandatory** before any parallel land and **cannot** be skipped by `autoMergeTo`; `autoMergeTo` only authorizes the *green* outcome to merge without a human. Sequential goals never enter this gate — each already integrated against live `develop` before the next began.

### 5. Result handling
- Record each goal PASS/FAIL only after the **proof gate** (`run-goals proof --id` exit 0, or `update_goal(completed: true)` for in-session).
- A **FAIL blocks its dependents** — skip + mark blocked; independent branches continue.
- **Re-dispatch once** with failure context appended; if it fails again or needs human input, **escalate to the in-session lane** or surface to the user — don't loop.
- Trust-but-verify: a `RESULT: PASS` is a claim. Spot-check the load-bearing evidence (run the doc's verification command, confirm the artifact) before accepting it.

### 6. Jira sync (only when a goal carries `jiraTaskKey`)
Delegate all Jira writes to the [[bytedesk-jira-task]] skill — do not hand-roll a second Jira client.
- On dispatch/start → transition the task **To Do → In Progress**.
- On PASS with PR open → add a comment (`PR #N ready for review`); **leave In Progress** — do not mark Done at PASS.
- **Done** only when the branch actually lands (after the integration gate / the user's merge). For autonomous-authorized batches, that's right after the gate-green merge; otherwise the user's merge triggers it.
- On FAIL → comment with the failure summary and leave the task open (add a `blocked` label if dependents are stuck).
- If `jiraEpicKey` is set, move the Epic **Done** only when all child tasks are Done (per project-management rules).

### 7. Report
End with a compact summary:
- Per goal: PASS / FAIL / BLOCKED (+ why) / SKIPPED, with the key artifact or PR link.
- Integration gate result (for parallel batches): green/red + what landed.
- What still needs the user (merges, deploys, approvals the docs reserved).
- Anything re-dispatched or escalated; Jira tasks transitioned.

### 8. Continuation pack after every level

At the end of each land-gated level, before compaction, interruption, or final
reply, emit a continuation pack that a fresh session can execute without
reconstructing the whole transcript:

```markdown
## Continuation Pack
Plan: docs/goals/<theme>.plan.json
Base proof: <origin/develop sha or target branch sha>
Completed and landed: <goal id -> PR/commit/Jira>
Completed but not landed: <goal id -> PR/status/blocker>
Current worktrees: <path -> branch -> dirty/clean>
localDev mapping: <develop-remote or worktree path>
Runtime state: <services rolled, Omnigent/plugin state if relevant>
Next task: <single concrete command or goal id>
Known blockers: <only real blockers, with evidence>
Residual follow-ups: <non-blocking items intentionally deferred>
```

For workflow epics, also include: current Office `/sources` count, Omnigent
plugin/runtime freshness, gateway health, and whether browser smoke has proven
the changed UI. This pack is not a substitute for verification; it is the
minimum state transfer needed for the next agent to continue correctly.

## Optional: batch-level done-ness
You may set a single session goal of "all manifest goals PASS or definitively blocked" so the run continues until the whole batch resolves. Do not set a separate Stop-hook per goal — the orchestrator is the loop.

## Constraints
- **Sequential is the default and the safe path.** Only fan out goals explicitly marked `"mode": "parallel"`. Parallelism buys wall-clock time at the cost of fidelity (subagents lose the Stop-hook) and integration risk — use it only for vetted-independent goals.
- **Never land a parallel goal without the integration gate.** Isolated PASS ≠ integrated PASS. No per-goal auto-merge, ever. Autonomous landing happens only through a green integration gate AND only when the plan/goal docs explicitly authorize it.
- **Never override a goal doc's own constraints.** Each doc's Constraints/Success criteria win; this skill only schedules. Reserved human actions (merge, deploy, prod mutations, spend) stay reserved unless that doc authorizes them.
- **`touches` is necessary, not sufficient.** It prevents obvious file collisions; the integration gate catches semantic conflicts. Default to serial when unsure.
- **Worktree lifecycle via the worktree-operator `scripts/dev/workflow.mjs`** (`new`/`ship`/`land`/`cleanup`; one worktree per parallel goal, always cleaned up). Never call `worktree.sh`, raw `git worktree`/`git branch -D`, or `gh pr merge` for managed worktrees, and do not use the Agent tool's generic `isolation: "worktree"` — see `.claude/rules/worktree-lifecycle.md`.
- **Concurrency discipline:** prefer chunks over very wide dispatch. A good
  starting cap is 6 Platform agents or 4 Omnigent agents. More than that needs
  explicit chunking and an integration-branch plan.
- **Jira via [[bytedesk-jira-task]]** only — no second Jira client. Task → Done on land, not on PASS.
- **One plan in flight at a time** unless the user asks otherwise; don't interleave two manifests.
- If the manifest is malformed or a `doc` is missing, stop and report — do not guess the plan.