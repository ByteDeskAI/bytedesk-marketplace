# Structurizr

Enterprise C4 modeling with Structurizr DSL — indexed language reference, CLI/MCP tooling, validation gates, pattern catalog, and cookbook recipes.

This plugin works across Claude Code, Codex, and grok-cli. Claude Code loads it via `.claude-plugin/plugin.json`; Codex via `.codex-plugin/plugin.json`; grok-cli and other AGENTS.md-aware agents read this file.

## MCP server

Register the `structurizr` stdio MCP server (Codex reads `.codex-mcp.json`; grok-cli / others use standard MCP config):

```json
{
  "mcpServers": {
    "structurizr": {
      "type": "stdio",
      "command": "<plugin>/structurizr/bin/structurizr-mcp"
    }
  }
}
```

## Skills & commands

- **c4-model-architect** (skill) — C4 abstraction level decisions and anti-patterns.
- **structurizr-abstraction-auditor** (skill) — Verify correct C4 abstraction level.
- **structurizr-archetype-designer** (skill) — Element and relationship archetypes.
- **structurizr-cli-operator** (skill) — Structurizr CLI push/pull/lock/merge.
- **structurizr-consistency-reviewer** (skill) — Pre-PR model consistency review.
- **structurizr-container-component-designer** (skill) — C2/C3 container and component decomposition.
- **structurizr-cookbook-executor** (skill) — Follow cookbook recipes step by step.
- **structurizr-custom-elements** (skill) — Custom elements outside C4.
- **structurizr-deployment-modeler** (skill) — Deployment environments, nodes, instances.
- **structurizr-diff-reviewer** (skill) — Workspace diff for PR review.
- **structurizr-docs-adrs** (skill) — Attach documentation and ADRs.
- **structurizr-drift-detector** (skill) — Compare model against codebase reality.
- **structurizr-dsl-language-reference** (skill) — Deterministic DSL keyword lookup — never guess syntax.
- **structurizr-dynamic-view-author** (skill) — Dynamic interaction/sequence views.
- **structurizr-enterprise-governance** (skill) — Multi-team workspace extension and governance.
- **structurizr-export-engineer** (skill) — Export to PlantUML, Mermaid, DOT, JSON.
- **structurizr-expression-builder** (skill) — Build include/exclude and bulk expressions.
- **structurizr-filtered-views** (skill) — Stakeholder-specific filtered views.
- **structurizr-inspector** (skill) — Workspace inspections and severity tuning.
- **structurizr-layout-merge** (skill) — Merge layout from JSON exports.
- **structurizr-model-builder** (skill) — Author model elements: people, systems, groups.
- **structurizr-modular-dsl** (skill) — Includes, constants, workspace extension.
- **structurizr-onprem-lite** (skill) — Structurizr Lite local workflow.
- **structurizr-orchestrator** (skill) — Front door for Structurizr/C4 modeling — routes to specialist skills and enforces validate/lint gates.
- **structurizr-pattern-catalog** (skill) — Apply Structurizr pattern catalog entries.
- **structurizr-perspectives** (skill) — Static and dynamic perspectives.
- **structurizr-relationship-designer** (skill) — Relationships, implied relationships, archetypes.
- **structurizr-script-plugin-author** (skill) — Scripts and Java plugins.
- **structurizr-styles-themer** (skill) — Element/relationship styles and themes.
- **structurizr-validator** (skill) — Validate and lint workspaces.
- **structurizr-view-composer** (skill) — Static views: landscape, context, container, component.
- **structurizr-workspace-scaffold** (skill) — Bootstrap workspace.dsl with enterprise layout.
- **structurizr-cookbook** (command) — Cookbook recipe
- **structurizr-diff** (command) — Model diff
- **structurizr-examples** (command) — Copyable MCP/CLI examples
- **structurizr-explain** (command) — Explain C4/DSL concept
- **structurizr-export** (command) — Export diagrams
- **structurizr-expression** (command) — Build include/exclude expression
- **structurizr-help** (command) — Show command catalog
- **structurizr-inspect** (command) — Run inspections
- **structurizr-lookup** (command) — DSL language reference lookup
- **structurizr-pattern** (command) — Pattern catalog lookup
- **structurizr-scaffold** (command) — Bootstrap workspace
- **structurizr-validate** (command) — Validate and inspect workspace
- **structurizr-architect** (agent) — Deep Structurizr workspace authoring — model, views, deployment, validation.
