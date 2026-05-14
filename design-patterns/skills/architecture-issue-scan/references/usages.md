# Architecture Issue Scan Usage

Use this reference when the user asks for a review, architecture scan, PR review, diagram review, or design-risk assessment through a pattern lens.

## Invocation Modes

- Code review: inspect concrete files for pattern-related risks.
- Architecture review: inspect diagrams, docs, or descriptions for coupling and integration issues.
- Smell inventory: identify repeated conditionals, god services, tangled constructors, or missing boundaries.
- Integration hardening: find delivery, idempotency, routing, observability, and failure-mode gaps.
- Refactor opportunity map: identify where a pattern would remove concrete risk.

## Input Expectations

Prefer real artifacts:

- repo paths;
- PR diff;
- architecture docs;
- workflow diagrams;
- endpoint or message definitions;
- test surfaces.

If only a prose description exists, state that findings are provisional and recommend evidence to inspect next.

## Output Contract

Lead with findings:

1. Severity and location if available.
2. Symptom.
3. Why it matters.
4. Pattern or simpler fix.
5. Smallest safe next step.
6. Test or observability check.

Keep optional improvements separate from actual risks.

Each finding should be decision-ready: include evidence, the architectural force, the catalog pattern or no-pattern fix, the tradeoff introduced by the fix, and the verification signal that proves the risk is lower. When no concrete evidence is available, label the item as a provisional concern rather than a finding.
