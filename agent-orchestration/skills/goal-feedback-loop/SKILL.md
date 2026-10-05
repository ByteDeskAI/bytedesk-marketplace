---
name: goal-feedback-loop
description: Coordinate an admitted Task Management goal through PM, governed implementation, independent validation, approved test deployment and dogfood until its accepted criteria are proven. Use when the user says "/goal-feedback-loop", "run the goal loop", "drive EP-n to done", "take this goal end to end", "deploy it to test and dogfood it", "prove the goal", "resume the goal loop", or names an admitted goal epic that should be implemented, validated and dogfooded rather than just planned.
user-invokable: true
argument-hint: "<EP-id> [--consumer <repo>]"
---

# Goal feedback loop

Use this workflow when the user has authorized a bounded product outcome and
wants the implementation checked in its approved test environment. Keep the
original goal and acceptance criteria authoritative. Improving the workflow is
in scope when a concrete finding explains why it failed to establish the goal.

1. Inspect `tm goal show <EP-id> --json` and `ao-topology goal-loop list
   --consumer <absolute-repository> --json`. Resume an existing loop before
   admitting another. Read current findings, actor custody and proof status.
2. If the goal has not been admitted, use the public `tm goal open` contract to
   record the authorized objective, criteria and authority. Reviewed integration
   and a named test target may be allowed; public release and destructive actions
   remain human gates. Use the repository's normal task-management workflow for
   creating and dispatching tasks.
3. Select the repository's already approved recipe from global AO configuration.
   Do not invent a target or executable, override an explicit enrollment veto,
   launch another broker, or write a repository-local replacement configuration.
   Run `ao-topology goal-loop start --consumer <absolute-repository> --goal <EP-id>
   --file <request.json> --json` with the current goal revision, scope hash,
   standing lead ID and recipe ID.
4. Follow the durable phase obligation. Bind every implementation task's exact
   source revision and landing to the aggregate artifact. Use separate governed
   evaluator tasks and retain their actual worker run and finish evidence. QA
   after integration checks the exact landed artifact that will be deployed.
5. Write a correlated report and submit it with the exact
   `ao-topology goal-loop report` command in the obligation. Publication, terminal
   activity and handled mail are not phase success. Preserve receipts and proof
   under the main checkout that owns the public TM store. A timeout does not prove
   the previous writer exited; resolve custody before requesting another attempt.
6. PM assessment compares deployment and dogfood observations with every accepted
   criterion. Record product, workflow, environment or knowledge failures as
   findings with corrective tasks. Use the existing `km find`, `km concept new`
   and `km link task` interfaces for sourced machine drafts and source-linked
   learning. Never fabricate a human verification stamp.
7. If a human decision is required, present its concrete summary, action, target,
   choices and consequences through the operator console. Agent-marked sessions
   cannot grant themselves this authority. Preserve the exact typed decision and
   chosen option; never treat approval as proof that the phase succeeded.
8. Stop when public TM proof verifies the accepted goal. Present any proposed
   next cycle for a separate decision. Do not start it automatically or expand
   completion criteria to keep the loop running.

The controller defaults to a persisted 30-minute deadline per phase, three
cycles without progress, and ten repair cycles after the initial attempt.
Inspect named blockers with `ao-topology goal-loop show`; recover using
`reconcile` or the authenticated operator controls. `show` and `list` do not
activate processes or consume mail. Full contract: [runtime documentation](../../docs/goal-loop-runtime.md).
