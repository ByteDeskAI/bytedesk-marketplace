---
name: architecture-issue-scan
description: Find source-neutral design-pattern issues in code, architecture docs, PRs, diagrams, or design notes.
when_to_use: Use when reviewing architecture or code for coupling, missing seams, lifecycle-state spread, message-flow risks, pattern misfit, over-patterning, or concrete refactoring opportunities.
argument-hint: "[path-or-description]"
user-invocable: true
disable-model-invocation: false
allowed-tools: Read Grep Glob Bash(patterns *)
model: inherit
---

# Architecture Issue Scan

Use this skill to find architecture and design issues that patterns can clarify or fix.

## References

- For invocation modes and output expectations, read [references/usages.md](references/usages.md).
- For finding examples and response shapes, read [references/examples.md](references/examples.md).
- For scan checklists, severity guidance, and recommendation rules, read [references/implementation.md](references/implementation.md).
- For catalog lookup commands and finding-to-domain mapping, read [references/catalog.md](references/catalog.md).

Scan for object-design issues:

- Repeated conditionals choosing behavior or types.
- Constructors that know too much about product families.
- God services, anemic wrappers, circular dependencies, and unstable abstractions.
- Inheritance used for configuration rather than behavior.
- Cross-cutting behavior duplicated instead of wrapped, pipelined, or decorated.
- Lifecycle state scattered across methods.

Scan for integration issues:

- Synchronous call chains where async messaging would reduce coupling.
- Missing idempotency for at-least-once delivery.
- No dead-letter, invalid-message, or retry terminal policy.
- Payloads with no version or format indicator.
- Routing rules spread across producers and consumers.
- No correlation identifiers, message history, or operational tap points.
- Oversized messages that should use claim check or message sequence.

Workflow:

1. Inspect the actual code or artifact before recommending changes.
2. Use `patterns recommend`, `patterns smells`, and `patterns search` to confirm candidate patterns and smells.
3. Separate real findings from optional refactor ideas.
4. Prefer local idioms and framework capabilities over textbook ceremony.

For review-style output, lead with findings ordered by severity. For each finding include:

- Symptom.
- Why it matters.
- Pattern that addresses the force.
- Smallest safe next step.
- Test or observability check that would prove the fix.

Avoid naming patterns as decoration. If a pattern does not remove concrete risk, say no pattern is needed yet.
