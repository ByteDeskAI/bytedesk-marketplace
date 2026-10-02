# Goal feedback loop

Approved implementation scope, 2026-10-01. Tracked in EP-022, TM-267 through TM-269;
Gateway owns its console adoption in its own task store.

## Outcome

Keep NATS and the existing Task Management, Agent Orchestration, and Gateway contracts.
Drive the original delegated goal through PM assessment, implementation, independent QA
and review, governed integration, validation of the landed artifact, approved test deployment, and dogfooding. Repeat only
for work needed to prove that goal. Stop with proof or a specific human decision.

The default limits are three consecutive repair cycles without new accepted criterion
evidence, ten repair cycles in total, and a thirty-minute persisted phase deadline.
Terminal activity and worker exit do not count as acceptance progress. Public release,
destructive changes, and changes to delegated scope require a separate human decision.

## Ownership and public boundaries

- TM owns the immutable original request, scope revisions, stable acceptance identities,
  findings, assessments, corrective tasks, and goal completion. AO calls its public CLI.
- AO owns durable mail receipts, publication recovery, phase obligations, deadlines,
  execution state, and the versioned workflow discovery/control contracts.
- Gateway reads producer state and invokes producer controls. It never edits AO records
  or consumes mail merely to display it.
- Knowledge feedback remains a sourced machine draft until independently verified;
  automation never manufactures a human-verification stamp.

## Message guarantees

Preserve original message identity, content digest, correlation, repository and recipient
identity, provenance, and task/workflow references. Persist an accepted recipient obligation
before broker ACK. Replay unfinished obligations after restart, including replies.
Publication intent precedes sending; a publication is recorded only after broker confirmation.
Retries retain the same identity; reusing an identity for different content is an error.

Published, accepted, claimed, handled, and independently reviewed are separate facts.
Receiving mail does not claim a task. Ownership transfer remains in TM and retains source
responsibility until successor ownership is recorded. Cross-component recovery is idempotent;
there is no claim of one transaction spanning TM and NATS.

## Goal and evidence guarantees

An admitted epic retains the original request and immutable acceptance baseline. Findings
and assessments name stable criterion IDs and the accepted scope revision. Product,
workflow, environment, and knowledge findings retain reproduction, expected and observed
behavior, corrective tasks, and evidence. Deployed proof names the exact source/artifact,
approved target, persona, evaluator, and evidence hashes. Stale proof, missing criteria,
unfinished corrective work, and blocking findings prevent completion.

The controller persists each phase obligation before notification. Reports bind the exact
loop, attempt, phase, obligation, goal revision, and artifact. Recovery resolves existing
writer ownership before another attempt. Workflow improvements are reviewed and evaluated
separately, then activated at a recorded boundary without changing the active goal's gates.

## Verification and rollout

Exercise real isolated NATS crash/redelivery and held-mail recovery; replay and concurrency;
stale evidence and false completion; phase deadlines and both repair limits; and a complete
failed-dogfood-to-repair-to-proof cycle. Verify plugin payloads from a clean consumer copy
without source dependencies. Check the authenticated Gateway console using agent-browser.

Start with explicit enrollment and Gateway-owned same-host NATS. Managed deployments must
not silently start a second broker. Keep `enabled:false` effective and verify credential
permissions rather than claiming that logical addresses are authentication. Disable new
loop admission for rollback while retaining tasks, receipts, evidence, and recovery history.
