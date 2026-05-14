---
name: pattern-finder
description: Find and compare reusable design patterns from a problem statement.
when_to_use: Use when the user describes a design force, smell, language constraint, integration flow, or architecture problem and needs a short pattern shortlist rather than a known pattern explanation.
argument-hint: "[problem-statement]"
user-invocable: true
disable-model-invocation: false
allowed-tools: Read Grep Glob Bash(patterns *)
model: inherit
---

# Pattern Finder

Use this skill to turn a problem statement into a short, practical pattern shortlist.

## References

- For force-discovery usage modes and output expectations, read [references/usages.md](references/usages.md).
- For smell-to-pattern examples, read [references/examples.md](references/examples.md).
- For force mapping and false-positive guidance, read [references/implementation.md](references/implementation.md).
- For catalog lookup commands and shortlist rules, read [references/catalog.md](references/catalog.md).

Start by identifying the forces in the user's request:

- Variation point: object creation, algorithm choice, object structure, lifecycle state, collaboration, message routing, transformation, delivery, or operations.
- Coupling pressure: which components know too much about each other.
- Runtime pressure: latency, durability, ordering, throughput, retries, observability, or deployment independence.
- Change pressure: what is likely to vary next.
- Language and framework: whether the local stack already has an idiom that should be preferred.

Consult pattern memory first: run `patterns memory recall --query "$ARGUMENTS"`. If a prior ADR decision already covers this force, surface it before building a fresh shortlist.

Lookup workflow:

1. Run `patterns recommend "$ARGUMENTS"` when the user describes a force, smell, or decision context.
2. Run `patterns list object-design --language <language>` for object design problems or `patterns list integration-design --language <language>` for messaging and integration problems when the language is known.
3. Run `patterns smells` or `patterns playbooks` when the problem sounds like issue detection or a pattern combination.
4. Read the relevant Markdown entries under `data/patterns`, `data/playbooks`, or `data/smells` before making a recommendation.

Response shape:

1. State the likely primary pattern.
2. Give two close alternatives and why they are weaker or stronger.
3. Explain what code or architecture would change.
4. Include language-specific advice if the language is known.
5. Name the signals that would make you change the recommendation.

Keep the shortlist tight. A good recommendation is usually one pattern, one backup, and one "do not use a pattern yet" option.
