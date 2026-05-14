# Pattern Application Usage

Use this reference when the user wants to apply a pattern to code or plan a concrete refactor.

## Invocation Modes

- Refactor planning: produce a decision-complete migration plan for a module or workflow.
- Guided implementation: modify code toward a selected pattern while preserving behavior.
- Pattern translation: convert catalog guidance into stack-specific code shape.
- Test planning: identify behavior, selection, and collaboration tests for the refactor.
- Rollback planning: keep the first change narrow and reversible.

## Input Expectations

Before changing code, gather:

- selected pattern or candidate patterns;
- target language and framework;
- files or module boundary;
- current behavior to preserve;
- tests that already cover the behavior;
- whether the change is local object design or integration flow.

## Output Contract

When planning:

1. Target pattern and exact force it addresses.
2. Boundary where the pattern will live.
3. Minimal code changes.
4. Compatibility and rollback notes.
5. Tests to run and expected observations.

When implementing:

1. Make one coherent refactor.
2. Preserve public behavior.
3. Run focused tests.
4. Explain the new collaboration shape.

Every implementation plan should also include rollback notes, compatibility risks, behavior-preserving tests, and the smallest first patch. If the requested pattern is too broad for one safe change, split it into phases and label later phases as follow-up work.
