# Design Patterns

Source-neutral advisor, Markdown reference catalog, MCP tooling, and dynamic workbench for software design patterns.

This plugin works across Claude Code, Codex, and grok-cli. Claude Code loads it via `.claude-plugin/plugin.json`; Codex via `.codex-plugin/plugin.json`; grok-cli and other AGENTS.md-aware agents read this file.

## MCP server

Register the `design-patterns` stdio MCP server (Codex reads `.codex-mcp.json`; grok-cli / others use standard MCP config):

```json
{
  "mcpServers": {
    "design-patterns": {
      "type": "stdio",
      "command": "<plugin>/design-patterns/bin/patterns-mcp"
    }
  }
}
```

## Skills & commands

- **architecture-decision** (skill) — Produce source-neutral architecture decision guidance using the design-pattern catalog, tradeoff analysis, and ADR-style output.
- **architecture-issue-scan** (skill) — Find source-neutral design-pattern issues in code, architecture docs, PRs, diagrams, or design notes.
- **integration-flow-review** (skill) — Review message-driven, event-driven, async workflow, broker, queue, stream, saga, or integration architecture.
- **pattern-advisor** (skill) — Advise on selecting, comparing, applying, reviewing, or invoking reusable software design patterns.
- **pattern-application** (skill) — Plan or implement a safe pattern-oriented refactor in an existing codebase.
- **pattern-finder** (skill) — Find and compare reusable design patterns from a problem statement.
- **patterns-adr** (command) — Generate an ADR-style seed backed by the pattern catalog
- **patterns-context** (command) — Build a model-ready pattern context pack for code and a design question
- **patterns-examples** (command) — Show copyable Design Patterns slash commands and MCP request examples
- **patterns-graph** (command) — Query the typed pattern catalog graph and relationships
- **patterns-help** (command) — Show help for all Design Patterns slash commands or one command
- **patterns-history** (command) — Recall this project's pattern memory — prior scans, decisions, and applied refactors
- **patterns-migrate** (command) — Plan a migration from a current smell or shape to a target pattern
- **patterns-recommend** (command) — Recommend design patterns for an architecture force or problem
- **patterns-scan** (command) — Scan a file or directory for pattern-relevant architecture smells
- **patterns-simulate** (command) — Score pattern options against architecture decision criteria
- **patterns-snippets** (command) — Fetch language-specific implementation snippets for pattern slugs
- **pattern-architect** (agent) — Reviews architecture and code through source-neutral design-pattern domains.
