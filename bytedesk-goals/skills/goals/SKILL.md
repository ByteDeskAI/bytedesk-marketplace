---
name: goals
description: >-
  Front-door administrator for the goal pipeline. Inventories docs/goals/ via
  goals-board.mjs and classifies every goal (available / in-progress / done /
  blocked / drift) from goal docs + live Jira + git. Routes to plan_goal,
  plan_epic, run_goals (run-goals), or /goal; resumes idle
  goals not active in a terminal; reconciles drift; cleans verified-Done goals.
  Use for "/goals", "goal status", "start a goal", "resume goals", "clean up
  goals", or administering the goal board. Delegates planning and execution —
  never reimplements them.
user-invokable: true
argument-hint: "status | plan <intent> | start <doc|manifest|intent> | resume [<id>|--all] | dashboard | reconcile | clean"
allowed-tools:
  - Bash
  - Read
  - Write
  - Grep
  - AskUserQuestion
  - mcp__atlassian__searchJiraIssuesUsingJql
  - mcp__atlassian__getJiraIssue
  - mcp__atlassian__editJiraIssue
  - mcp__atlassian__transitionJiraIssue
  - mcp__atlassian__getTransitionsForJiraIssue
  - mcp__atlassian__addCommentToJiraIssue
---

# Goals (orchestrator / administrator)

The single entry point for administering ByteDesk goals. It **composes** the
goal skills — it does not duplicate them:

- [[plan_goal]] — author one self-contained goal doc.
- [[plan_epic]] — Jira Epic + child Tasks, one goal doc per task + manifest.
- [[run_goals]] — execute a `*.plan.json` manifest (sequential/parallel + integration gate).
- `/goal <doc>` — the built-in Stop-hook "work until done" loop for one goal.
- [[bytedesk-jira-task]] — all Jira reads/writes.

Goal docs live in `docs/goals/*.md`; manifests in `docs/goals/*.plan.json`;
archived/none — **Done goals are deleted** (Jira + git history + Confluence are
the durable record). `docs/goals/` is the **active board**: it should only hold
live (not-done) work plus the generated dashboard.

## Verbs

### `status` (default)
Produce the enriched board AND regenerate `docs/goals/README.md` (ADR-0059).
1. **Gather the deterministic model**: run `goals-board` and parse its JSON — this returns the runtime panel (develop-remote drift, localDev mapping), each plan's DAG (mode/dependsOn/touches/needsHumanGate, startable vs blocked-on-unlanded-dep), and per-goal git/worktree/PR/`gitState`. Do **not** re-derive these by hand.
2. **Merge live Jira** via [[bytedesk-jira-task]] (Atlassian MCP): for each goal's `jiraTaskKey` and each plan's `jiraEpicKey`, fetch live status; this is the authority for **Done** and the epic rollup (the script intentionally doesn't call Jira). Combine git signals + Jira into the final class (see Status model).
3. **Render** `docs/goals/README.md` (the generated dashboard — see template) overwriting any prior version, and print a compact grouped table.

### `dashboard`
Open the **live cross-terminal dashboard** (ADR-0060) — a real-time view of goals → tasks/terminals consolidating every Claude session in the repo. Run `goals-dashboard open` (ensures one server per project dir via lock + deterministic port, then opens the browser). It also auto-launches on project load via the SessionStart hook; this verb is the manual entry point. The live server reuses `goals-board.mjs` + the cross-terminal session tail; it's the GUI complement to the markdown `status` board.

### `plan <intent>`
Planning is a first-class pipeline stage (ADR-0059) — `/goals plan` is the front door to it; the planning engines still own plan-mode. **Compose, don't reimplement.**
1. **Size the intent**: one shippable unit → invoke **[[plan_goal]]**; multi-task / needs a Jira Epic → **[[plan_epic]]**. (If the arg is already a `*.md`/`*.plan.json`, it's not a plan request — route to `start`.)
2. The engine runs the planning session: it **enters plan mode**, researches/interviews, writes the artifact(s) (`docs/goals/<theme>.md` (+ `docs/goals/<theme>.plan.json`), Jira Epic+Tasks for plan_epic), and **exits plan mode** (`ExitPlanMode`) with its runnable handoff (`/goal <doc>` or `/run_goals <manifest>`). Do not duplicate that logic here.
3. **On return, refresh the board**: regenerate `docs/goals/README.md` (the `status` flow) so the new goal/manifest appears immediately, then surface the next step (`/goals start <doc|manifest>` or the engine's handoff). Execution stays a separate explicit action (fresh context).

### `start <doc | manifest | intent>`
Route to the right skill — don't plan/execute inline:
- arg is a `*.plan.json` → `run-goals validate <manifest>`, then invoke **run_goals** (inline `run-manifest` loop).
- arg is a single `*.md` goal doc → `run-goals.mjs run-one` or `handoff`, then **`/goal <doc>`** semantics via [[run_goals]].
- arg is a fuzzy **intent** → route to the **`plan`** verb (size → plan_goal / plan_epic, then board-refresh). `start <intent>` is kept as an alias for `plan <intent>`.
- arg names an existing goal already **In progress** → resume it (point at its branch/worktree/manifest) rather than re-planning.
Before starting, run the relevant Jira transition via [[bytedesk-jira-task]] (To Do → In Progress) if the goal carries a key.

### `resume [<id> | --all]`
Pick up goals that are **available/in-progress, not Done/Blocked, and NOT being actively worked on in a terminal** — so you (or a cron) can resume the board where it left off without stepping on a session running in another terminal. **Compose, don't reimplement** — this routes to `run_goals` / `/goal` exactly like `start`, gated by the active-session check. **Default is list-and-pick** (you choose which to resume); `--all` resumes the whole set; `<id>` targets one.
1. **Get the candidate set deterministically**: run `goals-dashboard resumable` and parse its JSON. It returns `activeGoalIds` + `activeLooseWorktrees` (goals/worktrees with a live Claude session correlated to their worktree within `ACTIVE_WINDOW_HOURS`, ADR-0060) and `resumable[]` (each `{id, doc, plan, reason: "not-started"|"in-progress-idle", gitState, blockedBy}`) — the **git-layer** set: not landed on develop, not active in a terminal, and either startable (deps landed) or already in progress but idle. Genuinely blocked (unlanded deps, no work started) and landed goals are already excluded. Do **not** re-derive the active-session correlation by hand.
   - **Loose worktrees (BDP-1018):** entries with a `worktree` (plus `branch`, `bdpKey`) and no `doc`/`plan` are real `feature/BDP-N-slug` worktrees the docs don't name — work that exists in git but has no goal doc/manifest. They always carry `reason: "in-progress-idle"` and are surfaced unless merged or active in a terminal. **Resume continues these in place; it never starts them fresh** (see step 4).
2. **Refine with live Jira + judgment** (the script never calls Jira): drop any candidate whose `jiraTaskKey`/`jiraEpicKey` is **Done** (the git layer can miss this when a branch was named off-convention), and skip docs that aren't runnable goals (no BDP key + no success criteria, e.g. shared `*-CONTEXT.md` scaffolding). What remains is the resume set.
3. **Choose what to resume:**
   - **Default (no arg) — list & pick:** present the resume set and let the operator choose. Use `AskUserQuestion` (multi-select) with one option per resumable entry, each labeled with `id` + `reason` (`not-started` / `in-progress-idle`) + its `plan` (or "standalone", or "worktree `<branch>`" for a loose worktree) + any `blockedBy`. If the set is empty, report "nothing to resume" and why (all landed / Done / active in a terminal), then stop. Resume **only** the entries the operator selects.
   - **`--all` — resume the whole set:** skip the prompt and resume every goal in the resume set (the autonomous path, e.g. for a cron).
   - **`<id>` — targeted:** resume only that goal; verify it's in the resume set first. If it's active in a terminal, refuse and name the session that owns it.
4. **Route each chosen entry** (don't reimplement — same engines as `start`):
   - **Loose worktrees (entries with a `worktree`):** **continue the existing worktree — never start fresh over it.** `cd` into `.claude/worktrees/<worktree>` (the operator-managed checkout already on `feature/<branch>` with its commits) and resume work there: if it has a matched goal doc, run **`/goal <doc>`** from inside the worktree; otherwise pick up the branch directly (review `git log origin/develop..HEAD` + working tree, then continue). Do **not** call `workflow.mjs new`, do **not** create a second worktree/branch for the same BDP key, and do **not** run a planning engine over work that already exists in git.
   - **Specific goals** (list-pick selections or `<id>` with a `doc`): run each via **`/goal <doc>`** (the run_goals single-goal path), which resumes its existing branch/worktree if in progress or starts it fresh if not. They're in the resume set, so their deps are already landed.
   - **`--all`:** group resume-set goals by their `plan` manifest and invoke **run_goals** on each `docs/goals/<plan>` — idempotent + land-gated, so it respects `dependsOn` + `mode` and only advances the not-active/not-landed goals; run standalone (`plan: null`) goals via **`/goal <doc>`**; continue loose worktrees in place per the bullet above.
   - **Never** resume a goal in `activeGoalIds` or a worktree in `activeLooseWorktrees` (a terminal owns it). Reserved actions stay reserved — `resume` doesn't change run_goals' merge/integration-gate or `needsHumanGate`; nothing auto-merges unless the manifest's `integration.autoMergeTo` already authorizes it.
5. Before resuming each goal, transition its Jira **To Do → In Progress** via [[bytedesk-jira-task]] if it carries a key (idempotent). **On return, refresh the board** (the `status` flow).

**How "active in a terminal" is detected (scope):** the active-session check is **per-worktree, this-machine-only**. `goals-board.mjs` maps each goal to its managed worktree at `.claude/worktrees/<id>` via `git worktree list` + the `feature/<id>` branch convention; `activity()` then scans this machine's Claude session transcripts under `~/.claude/projects/`: it anchors on the **canonical** repo root (via `git --git-common-dir`, so it's correct even when run from inside a worktree) and reads the encoded project dir `<base>` plus every `<base>-…` dir. Because managed worktrees live **nested in the project at `.claude/worktrees/<id>`**, each worktree's path is a child of the repo root, so its encoded session-dir name is exactly `<base>-…claude-worktrees-<id>` — caught by that prefix match. A session is correlated to a goal when its `cwd` equals that goal's `worktreePath`, within `ACTIVE_WINDOW_HOURS` (6h). So a goal counts as "being worked on" iff a recent Claude session is running in its worktree **on this machine** — `resume` won't touch those, but it cannot see sessions on another machine (separate `~/.claude`). `resume` never creates/removes worktrees itself: not-started goals get a fresh operator-managed worktree from run_goals; in-progress-idle goals resume their **existing** worktree/branch. **Loose worktrees (BDP-1018):** the doc-driven goals only correlate on the `feature/<doc-id>` ↔ worktree naming, so a real `feature/BDP-N-slug` worktree with no goal doc would otherwise be invisible. `goals-board.mjs` now also emits `looseWorktrees[]` (every managed worktree under `.claude/worktrees/` except `develop-remote` whose branch isn't already a board goal), and the same `cwd == worktreePath` correlation marks a loose worktree active (`activeLooseWorktrees`). That closes the gap where a session working a BDP-keyed worktree was neither resumable nor seen as active — `resume` now both surfaces it (when idle) and protects it (when a terminal owns it).

### `reconcile`
Find and report **drift** between a goal doc and reality:
- doc has no Outcome/Done marker but its Jira key is Done (or its PR merged) → stale-open.
- doc marked done but Jira not Done / PR unmerged → premature-done.
- manifest goal landed but `jiraTaskKey` still To Do (or vice-versa).
Report each drift with the fix. Optionally stamp a single `> Status (auto, <date>): <class>` line near the top of the doc. **Never** change Jira to match a doc — Jira/git are the source of truth; correct the doc (or surface the Jira fix), not the other way around.

### `clean`
Tidy **verified-Done** goals only. For each cleanup-eligible goal (see policy):
1. Show the list and **ask for confirmation** (deletion is destructive).
2. Delete the goal `*.md` (and its `*.plan.json` if the whole plan is done). Untracked file → `rm`. Tracked file → `git rm` + a clear commit (`chore(goals): remove completed goal doc <name> (BDP-N done)`), following repo branch rules.
3. Prune lingering goal-run worktrees + their `feature/<key>` branches via the worktree-operator: `scripts/dev/workflow.mjs cleanup <name>` (removes worktree + branch, localDev-safe). Do not hand-roll `git worktree`/`git branch -D` — see `.claude/rules/worktree-lifecycle.md`.
4. Regenerate `docs/goals/README.md`.

## Status model (all DERIVED — never a stored status DB)
Recompute every run; do not maintain a parallel state file. The git/worktree/PR/manifest signals come from the **`goals-board.mjs`** assembler (one deterministic call); Jira is merged live via MCP; goal-doc markers refine.

| Source | Signal |
|---|---|
| **`goals-board`** (JSON) | runtime panel (develop-remote drift, localDev mapping, worktree/PR counts); per goal: branch, worktree, open PR + CI, `gitState`, `mergedToDevelop`; per plan: DAG (mode/dependsOn/touches/needsHumanGate/integration) + startable vs blocked-on-unlanded-dep; `looseWorktrees[]` (BDP-1018) — managed worktrees with no goal doc (`{name, branch, bdpKey, gitState, mergedToDevelop, pr, matchedGoalId}`) |
| **Jira** (via bytedesk-jira-task / MCP) | live status of each goal's key + the epic + all children (authority for **Done** + epic rollup) |
| Goal doc | title, `BDP-` key(s), markers: `## Outcome`, `STATUS: COMPLETE`, `Already done`, `> Status (auto…)` |

Classification:
- **Available (not started):** Jira To Do **and** no branch/worktree/open PR. Has a ready spec → safe to `start`.
- **In progress:** Jira In Progress, OR a branch/worktree/open PR exists, OR a manifest partially landed.
- **Done:** Jira Done (epic + all children) OR doc Outcome/COMPLETE, **and** no open branch/worktree/PR → cleanup-eligible.
- **Blocked:** an unlanded `dependsOn`, a `blocked` label, or a not-Done prerequisite.
- **Drift:** doc disagrees with Jira/git (handled by `reconcile`).

## Cleanup eligibility (hard rules)
A goal is deletable **only** when ALL hold: Jira (epic + children) **Done**; its PR(s) **merged**; **no** lingering worktree/branch/open PR. Then `clean` may delete it **after confirmation**.
- **Never** delete/modify a goal with unmerged work or non-Done Jira.
- Reserved actions (merge, deploy, prod mutations) stay with the human — `clean` only removes already-landed goals' leftover docs/branches.
- Deletion is confirmation-gated, always.

## Generated dashboard — `docs/goals/README.md`
Overwrite each `status`/`plan` run. First line marks it generated so no one hand-edits it. Populate every field from the `goals-board.mjs` model + the Jira merge:

```markdown
<!-- GENERATED by /goals status on <YYYY-MM-DD>; do not hand-edit. -->
# Goal board

## Runtime
- develop-remote: <current|stale (X vs Y)> · localDev → <develop-remote | worktree <id> (test-worktree)> · open PRs: <n> · worktrees: <n>

## Available (not started)
- **<doc>** — <BDP-N> (To Do) — <one-line goal>

## In progress
- **<doc/id>** — <BDP-N> (In Progress) — worktree `<id>` · PR #<n> <CI ✓/✗/pending> · lane <seq|parallel>

## Loose worktrees (no goal doc)
- **<name>** — <bdpKey> — branch `<branch>` · <gitState> · PR #<n>|none — needs a goal doc or cleanup

## Plans (epic-backed)
### <theme> — <BDP-EPIC> (<done>/<total> Done)<· auto-merge → develop if set>
- **<id>** <mode> — <BDP-N> <state> · deps: <ids|none> · <startable | blocked by <ids>> · PR #<n> <CI>
- _integration gate_: <N PRs green — ready to land | waiting on <ids>>  (parallel batches)

## Done (cleanup-eligible)
- **<doc/id>** — <BDP-N> (Done) — PR #<n> merged

## Blocked / drift
- **<doc/id>** — blocked by <unlanded dep ids> | drift: <doc vs Jira/git reason>
```

Omit empty sections. Keep it a snapshot — every value is re-derived next run; never hand-edit or treat as authoritative.

## Constraints
- **Compose, don't duplicate.** Planning (`plan`) + inventory/routing (`status`/`start`) + reconcile + cleanup only; the planning engines (plan_goal / plan_epic) own plan-mode and execution lives in run_goals. `/goals` routes in and refreshes the board out — it never reimplements the engines.
- **Derive status; no parallel store.** `docs/goals/README.md` is a regenerated snapshot, not a source of truth.
- **Jira/git are authoritative** for work state — reconcile fixes the doc, never forces Jira.
- **Destructive cleanup is opt-in + confirmed** and limited to verified-Done goals.
- **One board:** keep `docs/goals/` to live goals + the generated README; Done goals are removed.
