---
description: Score pattern options against architecture decision criteria
argument-hint: "help | <decision-or-options> [--language <language>] [--risk <risk>] [--limit <n>]"
---

# Patterns Simulate

Parse `$ARGUMENTS` into a `patterns_simulate` MCP call.

Help behavior:

- `/patterns-simulate help`, `/patterns-simulate --help`, or `/patterns-simulate -h` returns help only.
- Help must include purpose, usage, options, examples, backing MCP tool, and JSON argument mapping.
- Do not call `patterns_simulate` when the user asks for help.

Argument mapping:

- First quoted or unflagged text: `query` required.
- `--language <language>`: optional implementation language. If omitted, infer it from codebase files, path hints, and prompt terms.
- `--risk <risk>`: optional scorecard emphasis. If omitted, infer `operability`, `conservative`, `delivery`, or `balanced` from the request.
- `--limit <n>`: number of options to score, default `5`.

Inference behavior:

- Do not ask for `--language` just because it is missing.
- Infer language and scope context from the codebase and decision text before scoring.
- If evidence is ambiguous, score without a language filter and keep scope as `all`.
- If `query` is missing, return structured missing-argument detail because the decision cannot be safely inferred.

Examples:

```text
/patterns-simulate "Strategy vs Chain of Responsibility for AI provider failover" --risk operability
/patterns-simulate "Command vs State for workflow node execution lifecycle"
/patterns-simulate "event fanout with replay and dead-letter handling" --limit 4
```

Return a scorecard-style comparison, the recommended option, and the signals that would change the decision.
