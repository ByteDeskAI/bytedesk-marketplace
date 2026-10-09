# Original-goal feedback contract

An existing epic is the scope of record. Goal operations add versioned goal metadata to that epic; they do not create another task store or execution engine. The lead uses the public task-management CLI/MCP and the orchestration producer's public contracts.

## Public operations

```
tm goal open EP-001 --file admission.json --json
tm goal show EP-001 --json
tm goal finding EP-001 --file finding.json --json
tm goal assess EP-001 --file assessment.json --json
tm goal revise EP-001 --file scope-change.json --json
tm goal complete EP-001 --file completion.json --json
tm goal resume EP-001 --file resume.json --json      # CLI only, a human's decision
```

`--file -` reads JSON from stdin. The operation file may be temporary; evidence and receipt files must resolve inside the repository, including symlink targets. Existing `tm goal import` is unchanged.

MCP tools `tm_goal_open`, `tm_goal_finding`, `tm_goal_assess`, `tm_goal_revise`, and `tm_goal_complete` take `{id, input}` with the same JSON as the CLI. `tm_goal_show` takes `{id}`. Success is `{ok:true,id,goal}`; show also returns `verification`. Failure is `{ok:false,error}` (CLI includes `id` and exits nonzero). The bounded planner can read `tm_goal_show`; goal writers are excluded from its allowlist.

Each writer accepts optional `idempotencyKey`. Replaying an identical request returns the stored goal; different input with the same key is refused. Completion rechecks evidence even on replay. Clients must check `ok`; a successful worker exit or a past completion response is not fresh proof.

## Admission and authority

```json
{
  "objective": "The original user outcome",
  "criteria": [{"text":"The intended user can finish the deployed journey"}],
  "authority": {
    "reviewedMerge": true,
    "testTarget": "approved-test-environment",
    "publicRelease": "human",
    "destructive": "human"
  },
  "limits": {"maxStalls":3,"maxCycles":10,"phaseDeadlineMinutes":30},
  "idempotencyKey": "admission-1"
}
```

Admission records the policy the user has authorized; these fields are not proof that review, deployment, or acceptance happened. Admission assigns `AC-001`, `AC-002`, and so on. The original objective/criteria/hash remain in `goal.original`. Every scope revision is appended to `goal.revisions`; `goal.revision`, `goal.scopeHash`, `goal.objective`, and `goal.criteria` identify the current scope.

Defaults are three consecutive assessments without material progress and ten **repair cycles**, allowing the initial assessment plus at most ten repairs (eleven assessments total). `goal.cycles` counts recorded assessments; `goal.repairCycles` is `max(0, cycles - 1)`. The orchestration controller also counts repairs that fail before assessment. The thirty-minute deadline is a persisted **per-phase** deadline owned by that controller; `phaseDeadlineMinutes` records the policy and task-management does not impose an admission-time deadline on the whole goal. Limits may be lowered at admission, not silently increased. Progress means increasing the best proven-criterion count or resolving a finding, not a new commit, another worker, more output, or alternating which criterion passes. Budget exhaustion records `human_required` and a typed escalation. Scope changes do not reset budgets. This contract deliberately has no automatic resume after exhaustion: an explicit human intervention and a separately authorized new cycle are required.

### Resuming a human_required goal (TM-486)

`tm goal resume` is the one way out of `human_required`, and it is CLI-only: no MCP tool exists, the agent-orchestration autonomy allowlist never approves it, and it refuses outright when `TM_DISPATCH_WORKER` or `AO_AGENT_ID` is set (a dispatched worker skips permission prompts). Its input names the current `revision` and `scopeHash`, a `reason`, optional `grantCycles` (0-3), and `approval`: a receipt file in the repository with `schemaVersion: 1`, `kind: "resume"`, `goalId`, the same `revision`, `scopeHash`, `reason` and `grantCycles`, `escalationAt` equal to `goal.escalation.at`, `authorizedBy: "human:<owner>"`, and a `recordedAt` no earlier than the escalation. The receipt is bound to that one escalation, so it cannot be replayed for a later one. Resume resets the no-progress counter, raises `limits.maxCycles` by exactly `grantCycles`, refuses a zero grant when the cycle budget is spent, captures the receipt as evidence (rechecked at completion), and appends the old escalation to `goal.resumptions`; a goal takes at most three resumes. Same-user limit: the receipt is a file, so it records a human's decision but does not prove one; the CLI-only surface, the agent refusal and the grant caps are the guard.

Generic store/CLI/MCP/dashboard writes cannot replace goal history, change admitted criterion structure, delete the goal, close it, or move its child tasks out to evade completion checks. Legacy positional criterion ticks remain usable but cannot substitute for goal assessment. Unadmitted tasks retain their existing behavior. Finishing the last child does not automatically close an admitted goal.

## Findings

```json
{
  "category":"workflow",
  "criterionIds":["AC-001"],
  "observed":"The first validation omitted the deployed user journey",
  "expected":"Validate the deployed journey as its intended user",
  "reproduction":"Follow the recorded first-iteration validation steps",
  "source":"dogfood observation",
  "artifact":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "environment":"approved-test-environment",
  "persona":"project owner",
  "evidence":["evidence/observation.txt"],
  "correctiveTaskIds":["TM-001"],
  "blocking":true
}
```

Categories are `product`, `workflow`, `environment`, and `knowledge`. Findings receive `GF-001` identities and the scope revision/hash. Corrective tasks must belong to this epic. Blocking defaults to true. Findings remain in history; only a fresh independent assessment can resolve them. Product and workflow fixes use the same task, review, deployment, and proof path. Knowledge findings do not grant a human-verification stamp.

## Deployed independent assessment

Assessment input:

```json
{
  "revision":1,
  "scopeHash":"HASH_RETURNED_BY_OPEN",
  "artifact":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "environment":"approved-test-environment",
  "persona":"project owner",
  "evaluator":{"id":"validator","role":"dogfood","independentOf":["implementer"]},
  "implementerId":"implementer",
  "source":"evidence/dogfood.json",
  "deployment":"evidence/deployment.json",
  "criteria":[{"id":"AC-001","verdict":"proven","evidence":["evidence/browser-observation.txt"]}],
  "implementationTaskIds":["TM-001"],
  "resolvesFindingIds":["GF-001"],
  "idempotencyKey":"iteration-1-assessment"
}
```

The source receipt is JSON containing `schemaVersion:1`, `kind:"dogfood"`, `goalId`, `revision`, `scopeHash`, `artifact`, `environment`, `persona`, `evaluator`, `implementerId`, `recordedAt`, and `criteria`. Its criterion entries must match the assessment's IDs, verdicts, and evidence paths, and also contain nonempty `observed` and `expected` text. Verdicts are `proven`, `failed`, or `unproven`; proven criteria need at least one evidence file. Every current criterion must appear exactly once.

The deployment receipt is JSON containing `schemaVersion:1`, `kind:"deployment"`, `goalId`, `artifact`, `environment`, `deployedAt`, `actor`, and nonempty `source`. `artifact` is a full commit SHA. The environment must equal the admitted test target. Dogfood must follow the recorded deployment and current scope revision. Older deployment/assessment receipts cannot supersede newer ones. Evaluator roles are `dogfood`, `validation`, or `reviewer`; evaluator identity must differ from the implementer and explicitly list that implementer in `independentOf`.

Receipt and proof bytes are copied into the existing evidence directory with SHA-256 provenance. Completion verifies both original files and captured copies; deletion or drift refuses completion. These are recorded, independently attributed observations, not cryptographic proof of a person's identity or proof that arbitrary prose is true. The orchestration producer must bind evaluator identity to its actual independent worker and obtain receipts from real validation/dogfood. A boolean such as `proven:true` or `deployed:true` is never accepted as proof.

Assessments receive `GA-001` identities. `goal.latestAssessmentId` identifies the latest, and `goal.currentArtifact` tracks the latest observed artifact. Resolving a finding requires current proven affected criteria, a receipt recorded after the finding, and completed corrective tasks. `implementationTaskIds` likewise must identify completed tasks in this epic. Existing governed review/landing gates remain responsible for those task transitions.

## Revision and completion

A revision takes `{revision,scopeHash,reason,objective?,criteria,approval}`. Keep every existing criterion's `id` and exact `text`; new criteria omit `id`. Silent removals/replacements are refused. `approval` points to a JSON receipt with `schemaVersion:1`, `kind:"scope-change"`, `goalId`, matching prior `revision`/`scopeHash`, matching `reason`/`objective`/submitted `criteria`, `authorizedBy:"human:<decision-owner>"`, and `recordedAt`. The immutable receipt is captured with provenance. Revised scope invalidates prior acceptance proof and keeps the original scope intact. A different original outcome requires its own explicitly authorized goal.

Completion takes `{revision,scopeHash,artifact,environment,assessmentId?}`. It requires the latest assessment for the current scope and artifact, all original/current criteria proven, no unresolved blocking findings, every child task in the scope epic done, completed linked tasks, and unchanged evidence. Omitting a child from `implementationTaskIds` cannot bypass review or integration; deleted children also block because there is no approved supersession contract yet. It sets goal status `proven` and closes the epic. `show.verification.completionReady` performs the same proof checks without mutation; clients must consult it when displaying a previously proven goal whose evidence or linked tasks may have changed.

Once the original goal is proven, the conductor stops. It may propose additional product or workflow cycles; the proven goal does not grant permission for public release, destructive work, or an unbounded new objective.
