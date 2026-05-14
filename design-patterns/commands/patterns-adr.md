---
description: Generate an ADR-style seed backed by the pattern catalog
argument-hint: "help | <decision> [--language <language>] [--scope <scope>] [--status <status>]"
---

# Patterns ADR

Parse `$ARGUMENTS` into a `patterns_adr` MCP call.

Help behavior:

- `/patterns-adr help`, `/patterns-adr --help`, or `/patterns-adr -h` returns help only.
- Help must include purpose, usage, options, examples, backing MCP tool, and JSON argument mapping.
- Do not call `patterns_adr` when the user asks for help.

Argument mapping:

- First quoted or unflagged text: `query` required.
- `--language <language>`: optional implementation language. If omitted, infer it from codebase files, path hints, and prompt terms.
- `--scope <scope>`: optional catalog scope. If omitted, infer `object-design`, `integration-design`, a catalog domain, or `all` from codebase and prompt context.
- `--status <status>`: optional ADR status. If omitted, infer `Accepted`, `Superseded`, or `Deprecated` from decision wording, otherwise default `Proposed`.

Inference behavior:

- Do not ask for `--language` or `--scope` just because they are missing.
- Prefer explicit arguments when supplied.
- Otherwise infer from nearby project files, stack markers, path names, and the decision text.
- If evidence is ambiguous, use `all` for scope and omit the language filter.
- If `query` is missing, return structured missing-argument detail because the decision intent is not safely inferable from codebase context alone.

Examples:

```text
/patterns-adr "choosing between Registry and Chain of Responsibility for executor dispatch"
/patterns-adr "durable SSE event storage: Redis vs PostgreSQL" --status Proposed
/patterns-adr "message replay and dead-letter handling for order events"
```

Return a decision seed with context, options, recommendation, consequences, verification, and rollback signals.
