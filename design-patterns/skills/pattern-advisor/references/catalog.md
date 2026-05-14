# Pattern Advisor Catalog Use

## Primary Commands

```bash
patterns domains
patterns list object-design --language typescript
patterns list integration-design --language csharp
patterns search "router" --scope integration-design
patterns recommend "duplicate delivery repeats side effects" --scope integration-design
patterns compare strategy state template-method
patterns playbooks event-fanout
patterns smells naive-exactly-once
patterns frameworks dotnet-masstransit
patterns recipes strategy-refactor
patterns scorecards standard-architecture-decision
patterns explain strategy
patterns why "provider selection leaks into domain code"
patterns context ./src --query "provider selection leaks into domain code" --language csharp
patterns simulate "duplicate delivery repeats side effects" --language python
patterns graph --query "what mitigates naive exactly once"
patterns snippets idempotent-receiver --language python
patterns show strategy --language csharp
patterns languages go
```

## Domain Selection

- Use `object-design` when the main force is object construction, structure, collaboration, state, or algorithm variation.
- Use `integration-design` when the main force is messaging, routing, transformation, endpoint behavior, delivery, operations, or cross-system workflow.
- Use a narrower domain when the user names a specific force, such as `message-routing`, `object-construction`, or `operations-and-observability`.

## Reading Pattern Files

Pattern files provide:

- frontmatter for filtering;
- intent for quick fit;
- when-to-use and avoid-when bullets for tradeoffs;
- typed relationships for alternatives, companions, and commonly confused entries;
- decision metadata for quality attributes, testing, observability, and failure modes;
- language notes for object-design patterns;
- reference links to skill documentation.
- language-specific snippets for implementation examples.
- taxonomy-backed force and synonym matching for smarter recommendation ranking.

Prefer direct pattern files over memory when a user asks for a precise catalog-backed recommendation.
