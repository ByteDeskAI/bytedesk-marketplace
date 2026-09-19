---
id: "TM-194"
kind: "task"
status: "open"
created: "2026-09-12T19:00:56.646Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: lead-authored work can never satisfy the integration worker proof"
epic: "EP-019"
acceptance: [{"text":"A task with no dispatched worker either has a supported integration path, or admit refuses it up front instead of stranding it at integration","done":false},{"text":"That path does not require writing a dispatched record for a worker that never existed","done":false},{"text":"If lead authorship is to be refused, admitTask fails with that reason rather than the failure surfacing four steps later as an unprovable worker","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "58d7cd20-54ac-45c8-84a6-ea82dbebfad2"
labels: ["plugin:agent-orchestration","ready-for-human"]
triagedBy: "human"
updated: "2026-09-13T21:29:47.408Z"
---

Raised by the bytedesk-remote-gateway repository lead after four tasks (gateway TM-319,
TM-320, TM-321, TM-322) reached ready-for-review with an independent reviewer's verdict and
could not be integrated.

## The gate

integrationEligibility ends with:

    const writer = options.workerState ? await options.workerState(record) : await taskWorkerState(options, record);
    if (!writer.owned || writer.active !== false) reasons.push(writer.reason || '...');

taskWorkerState -> registeredWorker asserts:

    invariant(doc.dispatched?.run && doc.dispatched.session === owner,
      'TOPOLOGY_MANAGEMENT_WORKER', 'Task dispatch must name the claim owner and worker run.');

The proof it wants is that the writing process is GONE: matching worker incarnation, PID
identity checked against /proc start-time and boot id, processGone(pid), or an exited pane
with no live replacement. That is a good property and the reason to keep it.

## The gap

The whole chain hangs off doc.dispatched, which is set by `tm dispatch` when a worker is
spawned. The pipeline assumes lead -> dispatch -> worker -> finish. When the LEAD authors
the change itself, there is no worker process, so there is no worker whose exit can be
proven, and doc.dispatched is null:

    TM-319: dispatched=null
    TM-320: dispatched=null
    TM-304: dispatched={"backend":"topology","run":"topology:tm-304-...","session":"pool-tm-304"}   <- dispatched normally

taskWorkerState ends `catch (error) { return { owned: false, active: true, ... } }`, so it
fails closed. There is no override:

- options.authorized only affects the auto_merge reason; it does not touch the worker gate.
- options.workerState is an in-process function seam. It cannot come from --file and no CLI
  flag exposes it.

So lead-authored work is admitted, worked, finished, reviewed - and then stranded. The only
way to make the gate pass is to write a dispatched record naming a worker that never ran,
which is forging evidence in the one gate whose job is proving no writer is active.

## Why this is not just "the lead should not implement"

Agreed in general, and the lead prompt says exactly that. But the lead is the agent that
finds blocking defects while diagnosing why nothing can merge - in this case a CI gate that
was red on every branch, and a security test reporting three false privilege grants. Fixing
those is squarely the lead's job, and every such fix hits this wall.

If lead authorship must be refused, refuse it at admitTask with that reason, so the cost is
one command instead of admit + work + finish + an independent reviewer's time.

## Related

Third and fourth defects found in the same session: task-management touches recording
worktree-prefixed paths (currentCheckout preferring CLAUDE_PROJECT_DIR), the restricted
reviewer unable to acknowledge its own prompt because the ack needs a shell it does not
have, and collectReview failing on any verdict longer than the reviewer's pane width
(fixed on fix/reviewer-collect-reassembles-wrapped-json).
