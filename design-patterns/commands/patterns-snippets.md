---
description: Fetch language-specific implementation snippets for pattern slugs
argument-hint: "help | [<pattern-slug>[,<pattern-slug>...]] [--query <problem>] [--language <language>]"
---

# Patterns Snippets

Parse `$ARGUMENTS` into a `patterns_snippets` MCP call.

Help behavior:

- `/patterns-snippets help`, `/patterns-snippets --help`, or `/patterns-snippets -h` returns help only.
- Help must include purpose, usage, options, examples, backing MCP tool, and JSON argument mapping.
- Do not call `patterns_snippets` when the user asks for help.

Argument mapping:

- First positional value: comma-separated pattern slugs optional when `--query` can infer pattern slugs.
- `--query <problem>`: optional problem statement used to infer snippet pattern slugs when slugs are omitted.
- `--language <language>`: optional implementation language filter. If omitted, infer it from codebase files, path hints, and prompt terms.

Inference behavior:

- Do not ask for `--language` just because it is missing.
- Infer pattern slugs, language, and scope context before filtering snippets.
- If language evidence is ambiguous, return matching snippets across languages.
- If neither slugs nor an inferable query are supplied, return structured missing-argument detail.

Examples:

```text
/patterns-snippets strategy
/patterns-snippets strategy,idempotent-receiver
/patterns-snippets content-based-router,dead-letter-channel
```

Return snippets only when they are relevant to the requested language and pattern. Include the catalog slugs so the user can chain into `/patterns-context` or `/patterns-migrate`.
