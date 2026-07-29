# bytedesk-marketplace

ByteDesk's Claude Code marketplace. Plugins for parallel multi-session orchestration, design patterns, Structurizr C4 modeling, project management, and **platform engineering skills**.

## Plugins

| Plugin | Description |
|---|---|
| **[fleet](./fleet)** | Parallel multi-session orchestration, worktrees, dashboard |
| **[design-patterns](./design-patterns)** | Pattern catalog, MCP advisor, ADR seeds |
| **[structurizr](./structurizr)** | Enterprise C4 / Structurizr DSL (32 skills, MCP) |
| **[platform-dev](./platform-dev)** | TDD lifecycle, worktree operator, PR-ready, named agents |
| **[platform-architecture](./platform-architecture)** | C4 drift gate, decomposition facade, ADRs |
| **[platform-frontend](./platform-frontend)** | Web design system, atomize, browser smoke, SignalR |
| **[platform-domain](./platform-domain)** | DBA, tool actions, workflows, DevProjects proof ops |
| **[platform-ops](./platform-ops)** | TeamCity release policy, Gitflow operator |
| **[bytedesk-goals](./bytedesk-goals)** | Goal pipeline, run_goals, Jira/Confluence, agent dispatch |
| **[omnigent-dev](./omnigent-dev)** | Omnigent cross-repo engineering skills |

## Installation

```
/plugin marketplace add ByteDeskAI/bytedesk-marketplace
/plugin install platform-dev@bytedesk
/plugin install bytedesk-goals@bytedesk
```

Recommended platform checkout set (see `bytedesk-platform/.claude/settings.json`):

```
platform-dev platform-architecture platform-frontend platform-domain
platform-ops bytedesk-goals omnigent-dev fleet design-patterns structurizr
```

## Script placement

- Single-skill scripts: `<plugin>/skills/<skill>/scripts/`
- Multi-skill shared libs: `<plugin>/lib/`
- CLI entrypoints: `<plugin>/bin/` (forward to platform checkout when repo-coupled)

`scripts/dev/workflow.mjs` stays in **bytedesk-platform** (ADR-0058).

## Refresh from platform

From `bytedesk-platform`:

```bash
node scripts/dev/bootstrap-marketplace.mjs --apply
node scripts/dev/marketplace-link-skills.mjs --apply   # Codex/Grok symlinks
```

## License

[MIT](./LICENSE)