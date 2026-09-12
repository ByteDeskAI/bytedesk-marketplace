# TM-176 verification: computed readiness and automatic triage labels

**Result:** all eight acceptance criteria are met, and so is the lead's follow-up that a person's triage decision sticks. That includes clearing the label.

- **Worker commits:** `4026f69` (the feature), `4a3f6a8` (the human stamp) and `8b2f289` (merge of `main` at `0fe92e5`, which holds TM-174, TM-175 and TM-177), on branch `worktree-agent-a1d73d7bf5b881958`.
- **Merge to `main`:** the tree the lead merged into `main` is identical to `8b2f289`.

## What was measured

The lead ran every command below.

| Tree | Command | Exit | Result |
|---|---|---|---|
| `8b2f289`, worker worktree, clean | `node --test --test-concurrency=1 task-management/tests/unit/*.test.mjs` | 0 | 1444 / 1444 |
| same | `bash task-management/run-tests.sh contract` (every `tests/*.sh`) | 0 | "all green" |

- **Baseline:** on clean `cd1b1ac`, the worker's run gave 1374/1374 unit tests.
- **Load:** the worker's own run of the same three commands on `8b2f289` was concurrent. The lead re-ran them one at a time.

## Red before green (worker's run)

- **First draft of the veto tests:** 4 tests passed on unmodified code, because nothing was applying labels there yet. Each got a precondition or control, and then all 25 failed on the base.
- **Tests shown failing before their fix:**
  - the direct-update veto
  - removing a triage label the task doesn't have
  - `tm triage` refusing while auto-labelling is off
- **Follow-up test** "a person clearing the only triage label sticks": red on `4026f69` (the label came back as `['ready-for-agent']`), green after `4a3f6a8`.

## Acceptance criteria

1. **One readiness check.**
   - `agentReadiness(task, cfg)` in `lib/completeness.mjs` is the only check. A task is ready when all of these hold:
     - it has its `requireOnStart` fields
     - it has an epic when `requireEpic` is on
     - it has none of the labels `ready-for-human`, `needs-info`, `wontfix`, `human-gate`, `decision:interview`, `decision:prototype`, `decision:unblock` or `decision:map`
   - `TRIAGE_LABELS`, `DECISION_KIND` and `DECISION_MAP` live there. `issue.mjs` and `decision.mjs` re-export them, which removes a second copy of `DECISION_KIND`.
2. **Labels on create.** A complete task is created with `ready-for-agent` and `triagedBy: auto`. An incomplete task gets `needs-triage` and `triageMissing`.
3. **A person's label sticks.** A triage label a person sets, through any surface, is stamped `triagedBy: human` and survives later edits. Clearing the label sticks too.
4. **One write, no extra event.** The sync happens inside the same store write. Checked on the raw lines of `events.jsonl`:
   - editing a title adds exactly the `update` and `edit` lines, with no label event;
   - completing a task adds one `update` line, whose patch includes `labels,triageMissing`.
5. **The switch.** `dispatch.autoReady: "off"` disables the sync, and the setting is in the settings catalog.
6. **`--human`.** `tm task new --human` creates the task with `ready-for-human`, stamped human.
7. **`tm triage`.**
   - `tm triage --dry-run` lists changes and writes nothing; `tm triage --all` applies them.
   - Both skip tasks a person decided, and say how many they skipped.
   - While auto-labelling is off, it refuses with exit 2.
8. **Every task write goes through the sync.**
   - `graft callers create` and `graft callers update` (depth 2), plus grep for the label routes, show every task write reaches `create` or `update`: CLI, MCP, HTTP, goal import, planner ops and the harness mirror.
   - **One bypass:** the rollback in `planner-ops.mjs:270` writes a snapshot directly, and that snapshot was itself written through the funnel.
   - The unit suite exits 0.

## Existing tests changed (intended new behaviour, no looser assertions)

- `dashboard-api`, `export`, `issue` and `mcp` unit tests: exact label arrays now include the auto label.
- `test-concurrency.sh`: counts only the labels its race adds.
- `test-pool.sh`: its "not for agents" fixture now uses `--human`.

## Consequences to know

- **Any complete task can now be dispatched.** With `dispatch.enabled` on, the pool will pick up every complete task a person hasn't vetoed. That is the decision recorded in ADR-0012. Veto a task with `ready-for-human`, or by clearing its triage label.
- **The `human` stamp is permanent.** Once a task is stamped `human`, nothing hands it back to auto-triage. If that is ever needed, add a follow-up such as `tm label <id> --auto`.
- **The dashboard bundle was not rebuilt.** It only imports values that did not change.
