---
name: architecture-decision
description: Produce source-neutral architecture decision guidance using the design-pattern catalog, tradeoff analysis, and ADR-style output.
when_to_use: Use when a user asks for an architectural recommendation, ADR, pattern decision, tradeoff analysis, options comparison, implementation consequences, or a decision-ready pattern selection across object design, integration design, or both.
argument-hint: "[decision-context]"
user-invocable: true
disable-model-invocation: false
allowed-tools: Read Grep Glob Bash(patterns *)
model: inherit
---

# Architecture Decision

Use this skill when the user needs a decision, not just a pattern explanation.

## References

- For decision modes and output expectations, read [references/usages.md](references/usages.md).
- For realistic prompts and answer shapes, read [references/examples.md](references/examples.md).
- For decision workflow, scoring, and consequence guidance, read [references/implementation.md](references/implementation.md).
- For catalog lookup commands and decision-to-pattern mapping, read [references/catalog.md](references/catalog.md).

Decision workflow:

1. Identify the architectural force: variability, coupling, lifecycle state, integration delivery, routing, transformation, operations, or governance.
2. Use `patterns search`, `patterns show`, and `patterns recommend` where useful before relying on memory.
3. Compare one recommended pattern or pattern set against at least one serious alternative and one simpler no-pattern option.
4. State assumptions and decision drivers explicitly.
5. Include implementation consequences, migration steps, tests, observability, and rollback notes.
6. Keep pattern provenance out of the answer unless the user explicitly asks for it.

Decision output should be ready to paste into an ADR or engineering proposal. Prefer concrete consequences over pattern vocabulary. A good decision names what changes in code, ownership, runtime behavior, and operations.
