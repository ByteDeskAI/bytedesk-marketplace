---
description: Plan a migration from a current smell or shape to a target pattern
argument-hint: "help | <source> --to <target-pattern> [--language <language>] [--query <context>]"
---

# Patterns Migrate

Parse `$ARGUMENTS` into a `patterns_migrate` MCP call.

Help behavior:

- `/patterns-migrate help`, `/patterns-migrate --help`, or `/patterns-migrate -h` returns help only.
- Help must include purpose, usage, options, examples, backing MCP tool, and JSON argument mapping.
- Do not call `patterns_migrate` when the user asks for help.

Argument mapping:

- First quoted or unflagged text: `source` required unless `--query` supplies the current shape.
- `--to <target-pattern>`: `target` required unless the request names exactly one catalog pattern to migrate toward.
- `--language <language>`: optional implementation language. If omitted, infer it from codebase files, path hints, and prompt terms.
- `--query <context>`: extra project context.

Inference behavior:

- Do not ask for `--language` just because it is missing.
- Infer language and scope context from the source, target, query, and nearby project files.
- If evidence is ambiguous, plan without a language filter and keep scope as `all`.
- If `source` or `target` is not supplied and cannot be inferred, return structured missing-argument detail.

Examples:

```text
/patterns-migrate "hardcoded if/elif provider selection" --to strategy
/patterns-migrate "fat router with inline persistence and branching" --to facade
/patterns-migrate provider-switch-sprawl --to bridge --query "providers are GitHub, GitLab, and Bitbucket"
```

Return a staged migration plan with behavior-preserving tests, rollback points, and over-patterning warnings.
