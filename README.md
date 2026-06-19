# bytedesk-marketplace

ByteDesk's Claude Code marketplace. Plugins for parallel multi-session orchestration, hierarchical authorization, and developer tooling.

## Plugins

| Plugin | Description |
|---|---|
| **[fleet](./fleet)** | Parallel multi-session Claude orchestration. Spawn agents on tickets, run them in parallel git worktrees, watch a dashboard, get push notifications when reviews land or merges happen. Hierarchical authorization (ADR-0001) lets parent agents delegate to children safely. |
| **[design-patterns](./design-patterns)** | Source-neutral design-pattern advisor with Markdown catalog, MCP tooling, smell scans, and architecture decision support. |
| **[structurizr](./structurizr)** | Enterprise C4 modeling with Structurizr DSL — indexed reference, 32 skills, CLI/MCP, validation gates, patterns, and cookbook recipes. |

## Installation

Add this marketplace to Claude Code:

```
/plugin marketplace add ByteDeskAI/bytedesk-marketplace
```

Then install individual plugins:

```
/plugin install fleet@bytedesk
```

## Status

`v1.19.0` (2026-06-19) — **structurizr** plugin v0.1.0: enterprise C4/Structurizr DSL skills, indexed language reference, CLI, and MCP. Prior: design-patterns v0.9.x, fleet v1.16.x. The `fleet` plugin's v0.1 → v1.0 migration is documented at [`fleet/docs/MIGRATION.md`](./fleet/docs/MIGRATION.md).

## License

[MIT](./LICENSE)
