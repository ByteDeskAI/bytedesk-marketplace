# Project Management

Localized project management and documentation tool (Jira/Confluence equivalent) with MCP support for tasks, sprints, board status, and wiki pages. Real-time React SPA dashboard with @atlaskit components.

This plugin works across Claude Code, Codex, and grok-cli. Claude Code loads it via `.claude-plugin/plugin.json`; Codex via `.codex-plugin/plugin.json`; grok-cli and other AGENTS.md-aware agents read this file.

## MCP server

Register the `project-management` stdio MCP server (Codex reads `.codex-mcp.json`; grok-cli / others use standard MCP config):

```json
{
  "mcpServers": {
    "project-management": {
      "type": "stdio",
      "command": "<plugin>/project-management/bin/pm-mcp"
    }
  }
}
```

## Skills & commands

- **pm-board** (skill) — Show active sprint board, tickets list, and project status.
- **pm-doc** (skill) — Create, view, list, or search wiki/confluence documentation pages.
- **pm-init** (skill) — Initialize a localized project management workspace.
- **pm-planner** (skill) — PM planner — takes one sentence describing what you want, immediately enters planning mode, reads the codebase to reason about the work, then presents a breakdown (what it will do + tickets) for appro
- **pm-ticket** (skill) — Create, view, update, transition, or comment on tickets.
