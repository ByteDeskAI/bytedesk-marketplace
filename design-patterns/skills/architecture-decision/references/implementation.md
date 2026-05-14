# Implementation Guidance

Architecture decisions should make forces visible before naming patterns. A pattern is useful only when it changes risk, ownership, evolvability, or operability in a way the team can verify.

## Decision Steps

1. Frame the decision boundary. Name the module, flow, team boundary, runtime boundary, or API surface affected.
2. Extract forces. Look for variability, coupling, lifecycle state, delivery semantics, observability gaps, test seams, performance, privacy, and team familiarity.
3. Search the catalog. Use `patterns search <force>` first, then `patterns show <slug>` for likely candidates.
4. Compare options. Always include a serious alternative and a no-pattern or simpler-language-feature option.
5. Decide. Prefer the smallest pattern set that resolves the force without creating a new governance burden.
6. Verify. Tie the decision to tests, traces, metrics, rollout steps, and rollback signals.

## Scoring Rubric

Use a 1-5 qualitative score only when it helps the user compare options. Score complexity lower when an option adds indirection, lifecycle state, distributed coordination, schema governance, or operational ownership. Score operability higher when failures are visible, replayable, bounded, and documented.

## Failure Modes

- Pattern label without a force: reject it and restate the actual problem.
- Over-patterning: recommend a function, module, language feature, or framework primitive.
- Under-specified integration: block the decision on idempotency, dead-letter policy, ordering, and observability.
- Hidden ownership transfer: call out which team owns contracts, retries, schema changes, and support tooling.
- Migration without proof: require behavior parity tests or flow-level smoke tests before broad rollout.

## Quality Bar

A good decision lets a reviewer answer: why this pattern, why not the alternatives, what changes first, how failure is handled, how correctness is proven, and when to reverse course.
