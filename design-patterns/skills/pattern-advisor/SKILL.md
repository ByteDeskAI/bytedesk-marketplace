---
name: pattern-advisor
description: Advise on selecting, comparing, applying, reviewing, or invoking reusable software design patterns.
when_to_use: Use when a user asks which pattern fits, whether a pattern is overkill, how patterns compare, how to apply a pattern in a specific language, how to reason about object-design and integration-design tradeoffs, or how to make design-pattern MCP or slash-command requests.
argument-hint: "[problem-or-pattern]"
user-invocable: true
disable-model-invocation: false
allowed-tools: Read Grep Glob Bash(patterns *)
model: inherit
---

# Pattern Advisor

Use this skill to help users select, compare, implement, or review established software design patterns.

If a user asks for example MCP requests or how to call the design-patterns tool, return copyable `/patterns-*` slash commands first. Use `/patterns-examples` as the canonical answer shape and avoid replying with only MCP schema descriptions.

## References

- For usage modes and output expectations, read [references/usages.md](references/usages.md).
- For concrete prompt and answer examples, read [references/examples.md](references/examples.md).
- For decision checklists and implementation guidance, read [references/implementation.md](references/implementation.md).
- For catalog lookup commands and domain selection, read [references/catalog.md](references/catalog.md).

Prefer the bundled Markdown catalogs over memory:

- `data/patterns/*.md` contains source-neutral pattern entries.
- `data/playbooks/*.md` contains source-neutral pattern combinations for recurring architecture situations.
- `data/smells/*.md` contains source-neutral architecture smells and pattern responses.
- `data/languages/*.md` summarizes language and ecosystem idioms.
- The executable `patterns` is available on `PATH` after installation and can list, search, or show catalog entries.

When advising:

1. Start from the user's actual forces: coupling, variability, ownership, runtime constraints, failure modes, observability, testing, and team skill.
2. Identify whether the problem is object design, system integration, or both.
3. Recommend one primary pattern and at most two alternatives unless the user asks for a broader survey.
4. Include language-specific implementation advice when a language or framework is known.
5. Call out when a pattern is likely overkill, hiding a simpler language feature or framework primitive.
6. For integration-design patterns, include delivery semantics, idempotency, retry/dead-letter behavior, message shape, and observability considerations.
7. For object-design patterns, include the collaboration shape, dependency direction, test seams, and common misuses.
8. Treat pattern origin as irrelevant unless the user explicitly asks for provenance.

Useful lookup commands:

```bash
patterns domains
patterns list object-design --language typescript
patterns list integration-design --language csharp
patterns search "router"
patterns search "router" --scope integration-design --language typescript
patterns recommend "duplicate messages cause repeated side effects" --scope integration-design
patterns compare strategy state template-method
patterns playbooks event-fanout
patterns smells naive-exactly-once
patterns show strategy
patterns show content-based-router
patterns languages
```
