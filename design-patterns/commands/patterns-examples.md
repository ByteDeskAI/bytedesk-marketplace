---
description: Show copyable Design Patterns slash commands and MCP request examples
argument-hint: "help | [topic-or-empty]"
---

# Design Patterns MCP Examples

Return copyable slash commands, not descriptions of MCP schemas.

If the user asks for "example MCP requests", "how do I call the design patterns tool", or similar wording, answer with `/patterns-*` commands first. Keep tool names and parameter schema explanations secondary.

Call the `patterns_examples` MCP tool when available. If the tool is unavailable, use the examples below directly.

Inference behavior:

- Omit `--language` and `--scope` unless the user explicitly wants to override inference.
- The plugin infers both from codebase files, path hints, stack markers, and the request text.
- Examples should demonstrate inference-first requests.

Help behavior:

- `/patterns-examples help`, `/patterns-examples --help`, or `/patterns-examples -h` returns help only.
- Help must include purpose, usage, options, examples, backing MCP tool, and JSON argument mapping.
- Do not call `patterns_examples` when the user asks for help unless using `patterns_help` to retrieve this help.

Use this response shape:

```text
/patterns-examples [topic]
/patterns-help [command]
/patterns-recommend "<architecture force or problem>" [--risk <risk>] [--limit <n>]
/patterns-scan <path> [--min-confidence <0-1>] [--include-docs] [--include-generated]
/patterns-context <path> --query "<problem>"
/patterns-simulate "<decision or competing options>" [--risk <risk>] [--limit <n>]
/patterns-migrate "<current smell or source shape>" --to <target-pattern> [--query "<context>"]
/patterns-snippets <pattern-slug>[,<pattern-slug>...]
/patterns-adr "<architecture decision>" [--status <status>]
/patterns-graph ["relationship question"] [--format json]
```

Omit `--language` and `--scope` unless the user explicitly wants to override inference. The plugin infers both from codebase files, path hints, stack markers, and the request text.

Examples:

```text
/patterns-help patterns-scan
/patterns-scan help
/patterns-recommend "add a new SCM provider without changing rule execution code" --limit 5
/patterns-scan backend/app/workflow_engine --min-confidence 0.45
/patterns-context backend/app/providers/ai --query "adding a new AI provider safely"
/patterns-simulate "Strategy vs Chain of Responsibility for AI provider failover" --risk operability
/patterns-migrate "hardcoded if/elif provider selection" --to strategy
/patterns-snippets strategy,idempotent-receiver
/patterns-adr "durable event storage for SSE replay: Redis vs PostgreSQL"
/patterns-graph "what patterns mitigate naive exactly once"
```

If a user asks for raw MCP payloads, include the corresponding tool and arguments after the slash command:

```text
/patterns-recommend "duplicate delivery repeats side effects" --language python
MCP tool: patterns_recommend
Arguments: {"query":"duplicate delivery repeats side effects","language":"python"}
```
