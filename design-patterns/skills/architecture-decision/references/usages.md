# Usage Modes

Use this skill when the user needs architectural judgment that can survive implementation review. It is appropriate for ADRs, technical design reviews, pull-request design comments, refactor direction, integration hardening decisions, and pattern tradeoff questions.

Good inputs include a code path, architecture note, diagram description, production failure, integration flow, refactor goal, or a debated set of options. If the user gives only a vague problem, first infer the likely forces and state the assumptions before recommending a path.

## Output Contract

Return decision-ready guidance with these sections:

1. Decision summary: one paragraph in plain engineering language.
2. Context and forces: the constraints that matter.
3. Options considered: recommended option, serious alternative, and simpler no-pattern option.
4. Tradeoff matrix: compare coupling, complexity, operability, testability, delivery risk, and team fit.
5. Recommended pattern set: primary pattern plus companion patterns only when needed.
6. Consequences: code shape, ownership, runtime behavior, operations, and migration impact.
7. Verification plan: tests, observability checks, rollout guardrails, and rollback signal.

For code-grounded decisions, cite concrete files and line numbers. For concept-only decisions, label assumptions rather than pretending evidence exists.

## Workflow Variants

- ADR draft: produce a concise decision record with status, context, decision, alternatives, and consequences.
- Review comment: lead with the risk and smallest actionable change.
- Refactor choice: include file/module boundaries and migration sequence.
- Integration decision: include delivery semantics, idempotency, ordering, retry/dead-letter behavior, and observability.
- Pattern comparison: explain what would make each option wrong.
