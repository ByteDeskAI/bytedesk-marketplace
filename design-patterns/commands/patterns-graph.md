---
description: Query the typed pattern catalog graph and relationships
argument-hint: "help | [relationship-question] [--format json]"
---

# Patterns Graph

Parse `$ARGUMENTS` into a `patterns_graph` MCP call.

Help behavior:

- `/patterns-graph help`, `/patterns-graph --help`, or `/patterns-graph -h` returns help only.
- Help must include purpose, usage, options, examples, backing MCP tool, and JSON argument mapping.
- Do not call `patterns_graph` when the user asks for help.

Argument mapping:

- Quoted or unflagged text: optional `query`.
- `--format json`: request graph-shaped output when the caller needs machine-readable relationships.

Inference behavior:

- Graph queries use the full catalog relationship map.
- Language and scope are not required for this command, but follow-up recommendations should infer them when omitted.

Examples:

```text
/patterns-graph
/patterns-graph "what patterns are related to observer"
/patterns-graph "what patterns mitigate naive exactly once"
/patterns-graph "which patterns are companions of content-based-router" --format json
```

Return graph answers with relationship types, linked slugs, and enough context to pick the next command.
