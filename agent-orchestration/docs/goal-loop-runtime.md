# Goal feedback controller

The controller coordinates an admitted Task Management goal through the existing
repository lead. It does not launch a separate task executor or execute deployment
commands itself. Task Management owns goal scope, findings and completion proof;
AO owns phase obligations, task and evaluator custody, delivery and retries.

## Admission and progress

Use `ao-topology goal-loop start --consumer <absolute-repository> --goal EP-001
--file <request.json> --json`. The request contains `idempotencyKey`, `actor.id`,
`goalRevision`, `scopeHash`, `leadId` and `deploymentRecipeId`. The global AO config
must contain exactly one matching repository-scoped recipe:

```json
{
  "goal_loop": {
    "enabled": true,
    "deploymentRecipes": [{
      "id": "approved-test", "version": "1",
      "repositoryId": "<canonical repository identity>",
      "target": "<goal authority testTarget>",
      "command": "/approved/deployer", "args": ["--revision", "{artifact}"]
    }]
  }
}
```

An explicit repository disable vetoes admission. The recipe entry is explicit
opt-in; a Git repository's default enrollment alone is insufficient. Global
`goal_loop.enabled:false` stops new admission without removing recovery history.
Commands and arguments are retained as a versioned, hashed recipe. The lead uses
that approved recipe through the existing deployment workflow. The controller
does not treat a caller-provided shell command as a deployment recipe.

The phases are PM, build, QA, independent review, governed integration, QA of the
exact landed aggregate, test deployment, dogfood, and PM assessment. PM binds
every accepted criterion to implementation tasks. Build and integration retain
each task's source and landed revisions, and verify that the aggregate contains
them. Evaluation tasks are separate from implementation tasks, belong to the
same goal, and retain the observed worker run and its finish evidence. An
evaluator label by itself is insufficient.

Admission is persisted before `activateRepository` starts or finds the existing
repository supervisor. Activation runs outside the loop lock, so the supervisor
can finish its first tick. The supervisor's normal L2 reconciliation recovers
pending phase reports and deliveries after restart. Activation, delivery and
notification failures remain visible and retryable. No show/list operation
activates a supervisor, rings a terminal or consumes a mailbox delivery.

An obligation is written before publication. NATS PubAck establishes publication,
not receipt or successful work. The registered lead receives a short pointer
through the existing safe composer check, on its exact recorded tmux server and
pane incarnation. A busy or unproven composer is held and retried. Successful
notification is retained by obligation and incarnation; it is not called an
acknowledgement. Goal loop delivery sets `AO_NATS_AUTOSTART=0`, so an unavailable
Gateway broker produces a diagnostic instead of launching a second broker.

## Reports, evidence and recovery

Each obligation contains its exact `ao-topology goal-loop report` command and a
JSON template. Reports bind the goal revision, scope hash, phase, attempt,
obligation and current artifact. A direct report must come from the admitted
standing lead's launcher identity; a recovered mailbox reply must name the same
recipient. A publication or handled receipt never advances a phase.

Evidence paths resolve relative to the repository's main checkout, which owns the
public TM store, even when the loop starts from a linked worktree. Paths must stay
inside that checkout, including symlink targets. Referenced deployment and
dogfood receipts and criterion evidence are retained and hashed with the phase
report, even when omitted from its top-level evidence list. Replay checks the
same bytes. Assessment rechecks the earlier successful deployment and dogfood
reports, preventing a replacement receipt from changing their meaning.

Report keys are immutable: the same key and content replay, while different
content is refused. TM findings, assessments and completion use stable public
CLI idempotency keys. The authoritative `tm goal show` verification determines
whether the loop completes, repairs or needs a human decision. Even after
completion, inspection rechecks current proof and displays it as unproven if the
receipts changed or cannot be checked. Original goal intent is retained separately
from later reviewed scope revisions.

Each phase gets its own persisted deadline, normally 30 minutes, from
`goal.limits.phaseDeadlineMinutes`. Late reports cannot extend it. Three
consecutive cycles without progress or ten repair cycles stop automatic retries;
the initial attempt does not consume a repair cycle. Retry first resolves prior
task writers, including producer-confirmed cleanup whose claim and worktree no
longer exist. Uncertain or replacement writers hold the loop. An operator stop
does not terminate task writers.

The controller stops when the original accepted goal is proven. A next-cycle
proposal is retained for the operator; it does not start another goal. PM and
assessment use the existing KM public commands to retain sourced machine drafts
and task links. Optional `knowledgeRefs` retain their source goal, finding,
artifact and evidence; they do not grant human verification.

## Authority and limits

Operator control is revision-checked and attributed. An explicitly unauthenticated
channel is denied, as are agent-marked local sessions. The authenticated Gateway
boundary can attest a human operator; an `actor.kind` string cannot. An unmarked
local operator process remains within the existing same-user trust boundary.
This is not a cryptographic defense against a process that can rewrite the user's
AO state or environment.

Public release and destructive actions require an exact typed human decision.
Approval creates a new correlated continuation, never a successful phase result.
Goal authority and deployment recipe changes require explicit reviewed decisions
at an attempt boundary; a recipe approval names the exact recipe hash. Changes
to evidence, task custody or provider availability remain blockers rather than
permission to silently substitute another writer, evaluator or deployment.

Unit coverage uses disposable state and injected process/transport boundaries.
A public CLI contract fixture runs the real TM goal commands in a disposable
consumer and proves assessment, completion and drift rejection. These checks do
not claim live agent launch, provider engagement, deployment or browser acceptance.
