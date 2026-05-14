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
2. Consult pattern memory: `patterns memory recall --query "<force>"`. If an `accepted` ADR already covers this force, cite it and stop unless the user is explicitly reconsidering it — do not re-decide what is already decided.
3. Use `patterns search`, `patterns show`, and `patterns recommend` where useful before relying on memory. Use `patterns adr "<decision>"` to draft a catalog-backed seed — it records the ADR to pattern memory and reports its number.
4. Compare one recommended pattern or pattern set against at least one serious alternative and one simpler no-pattern option.
5. State assumptions and decision drivers explicitly.
6. Include implementation consequences, migration steps, tests, observability, and rollback notes.
7. Keep pattern provenance out of the answer unless the user explicitly asks for it.
8. When the user accepts a decision, record it: `patterns memory record --kind decision --adr <n> --status accepted` (the number comes from the `patterns adr` output). If the decision supersedes an earlier ADR, also record `--kind decision --adr <old-n> --status superseded` so memory stops surfacing the old one as current.

Decision output should be ready to paste into an ADR or engineering proposal. Prefer concrete consequences over pattern vocabulary. A good decision names what changes in code, ownership, runtime behavior, and operations.
