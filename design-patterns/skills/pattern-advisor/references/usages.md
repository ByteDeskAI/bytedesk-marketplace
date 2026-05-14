# Pattern Advisor Usage

Use this reference when the user asks for pattern advice but has not necessarily named a concrete implementation task.

## Invocation Modes

- Pattern selection: choose a pattern from a stated design force, smell, or workflow.
- Pattern comparison: compare two or more candidate patterns and explain the tradeoff.
- Pattern sanity check: decide whether a named pattern is appropriate or over-engineered.
- Language guidance: translate a pattern into idiomatic C#, Java, TypeScript, Python, Go, Rust, or C++.
- Architecture review support: explain how pattern choices change coupling, ownership, test seams, or integration risk.

## Input Expectations

Ask for or infer:

- language and framework;
- object-design versus integration-design focus;
- current pain point;
- what is expected to vary;
- lifecycle, deployment, or operational constraints;
- whether code changes are requested or only advice.

If the user provides code or paths, inspect them before recommending. If the user only provides a design question, use the catalog and language profiles first.

## Output Contract

Prefer this structure:

1. Primary recommendation.
2. Why it fits the forces.
3. Alternatives and why they are weaker or narrower.
4. Language-specific implementation notes.
5. Tests or design checks that would prove the pattern is useful.
6. A "do not use yet" note if the pattern would add ceremony without removing risk.

When the answer influences architecture, add a compact decision block: assumptions, decision drivers, tradeoffs, consequences, and verification. Keep the pattern name secondary to the force it resolves.

## Progressive Disclosure

Load these sibling references as needed:

- `examples.md` for concrete answer shapes.
- `implementation.md` for pattern application and anti-overuse checks.
- `catalog.md` for lookup commands and domain filters.
