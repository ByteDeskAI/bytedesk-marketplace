---
slug: standard-architecture-decision
name: Standard Architecture Decision Scorecard
domain: decision-scorecard
category: Decision Scorecards
groups:
  - architecture-scorecard
criteria:
  - complexity
  - coupling
  - operability
  - testability
  - migration-risk
  - reversibility
references:
  - skills/architecture-decision/references/implementation.md
---

# Standard Architecture Decision Scorecard

## Intent
Compare pattern options with consistent decision criteria instead of relying on pattern familiarity.

## Scale
- 1: weak fit or high risk.
- 3: acceptable with known tradeoffs.
- 5: strong fit with clear verification.

## Criteria
- Complexity: amount of indirection, coordination, lifecycle state, and cognitive overhead introduced.
- Coupling: how well the option reduces unnecessary knowledge between modules, teams, or systems.
- Operability: how visible, recoverable, bounded, and supportable failures become.
- Testability: how easy it is to prove behavior, contracts, failure paths, and migration safety.
- Migration Risk: how likely the change is to disrupt existing behavior or rollout.
- Reversibility: how easy it is to roll back or narrow the decision if assumptions are wrong.

## Output Contract
Use a table with one row per option and one column per criterion. Include a short rationale for the recommendation and a verification plan for the chosen option.

## Anti-Patterns
- Do not let the total score hide a P1 operational or security risk.
- Do not score hypothetical future flexibility higher than current simplicity without evidence.
- Do not compare options that solve different forces.
