---
description: Build a model-ready pattern context pack for code and a design question
argument-hint: "help | [path] [--query <problem>] [--language <language>] [--scope <scope>] [--pack <pack>]"
---

# Patterns Context

Parse `$ARGUMENTS` into a `patterns_context` MCP call.

Help behavior:

- `/patterns-context help`, `/patterns-context --help`, or `/patterns-context -h` returns help only.
- Help must include purpose, usage, options, examples, backing MCP tool, and JSON argument mapping.
- Do not call `patterns_context` when the user asks for help.

Argument mapping:

- First positional value: `path` optional when the MCP working directory is a project; otherwise the tool returns structured missing-argument detail.
- `--query <problem>`: optional; inferred as a generic architecture-guidance query from the resolved path when omitted.
- `--language <language>`: optional implementation language. If omitted, infer it from codebase files, path hints, and prompt terms.
- `--scope <scope>`: optional catalog scope. If omitted, infer `object-design`, `integration-design`, a catalog domain, or `all` from codebase and prompt context.
- `--pack <pack>`: optional scan rule pack; inferred from scope, path, and query markers when omitted.

Inference behavior:

- Do not ask for `--language` or `--scope` just because they are missing.
- Prefer explicit arguments when supplied.
- Otherwise infer from the target path, nearby project files, stack markers, and the query.
- If evidence is ambiguous, use `all` for scope and omit the language filter.
- If `path` cannot be inferred, return missing-argument detail instead of building context from the plugin install directory.

Examples:

```text
/patterns-context backend/app/providers/ai --query "adding a new AI provider safely"
/patterns-context frontend/src/state --query "managing streaming job state"
/patterns-context services/orders --query "duplicate message handling and replay"
```

Return a compact context pack: scan findings, recommendations, relevant snippets, and an ADR seed when useful.
