---
name: pattern-application
description: Plan or implement a safe pattern-oriented refactor in an existing codebase.
when_to_use: Use when a user wants to apply a selected pattern, refactor code toward a pattern, generate language-specific implementation steps, or identify the smallest safe boundary for introducing a pattern.
argument-hint: "[pattern] [path-or-module]"
user-invocable: true
disable-model-invocation: false
allowed-tools: Read Grep Glob Bash(patterns *) Bash(git status *) Bash(git diff *) Bash(git grep *)
model: inherit
---

# Pattern Application

Use this skill to move from pattern choice to a safe implementation.

## References

- For refactor invocation modes and output expectations, read [references/usages.md](references/usages.md).
- For concrete refactor examples, read [references/examples.md](references/examples.md).
- For implementation sequence, testing, and failure-mode guidance, read [references/implementation.md](references/implementation.md).
- For catalog lookup and field usage, read [references/catalog.md](references/catalog.md).

Before changing code:

1. Consult pattern memory first: `patterns memory recall --query "<force>" --path <target-module>`. If a prior ADR decision already covers this force, or the target module already shows applied patterns in `patternIndex`, build on that instead of re-introducing a pattern — and say what memory already knows.
2. Confirm the actual force being addressed.
3. Inspect the current files and tests.
4. Look up the selected pattern with `patterns show <slug>`.
5. Check `patterns playbooks <slug>` when the change is a pattern combination.
6. Check `patterns smells <slug>` when the change is motivated by an architectural smell.
7. Check `patterns languages <language>` or `data/languages/<language>.md` for stack idioms.
8. Identify the smallest boundary where the pattern can live.

Implementation rules:

- Keep the first refactor narrow and reversible.
- Preserve public behavior unless the user asks for behavior change.
- Add seams around variation points, not around everything.
- Keep names domain-specific; avoid generic names like `ConcreteStrategy` in production code.
- Add tests at the behavior boundary, not only class-construction tests.
- For messaging patterns, include retry, idempotency, correlation, observability, and dead-letter behavior where relevant.

Recommended output when planning:

1. Target pattern and why it fits.
2. Files or modules to change.
3. Step-by-step migration.
4. Compatibility and rollback notes.
5. Tests and runtime checks.

Recommended output when implementing:

1. Make the smallest coherent patch.
2. Run existing focused tests.
3. Explain the new collaboration shape with file references.
4. Call out follow-up refactors separately from the completed change.
5. Record the outcome in pattern memory once the patch lands and focused tests pass: `patterns memory record --kind applied --pattern <slug> --target <module> --summary "<what changed>"`. Add `--adr <n>` when the refactor implements a recorded decision and `--verified` when tests or runtime checks confirmed it. This is what lets future sessions see the module already has this pattern.
