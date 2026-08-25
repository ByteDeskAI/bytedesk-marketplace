# bytedesk-marketplace

ByteDesk's Claude and Codex plugin marketplace. Plugins for parallel orchestration, design systems, architecture, project management, and platform engineering.

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
| **[teamcity-mcp](./teamcity-mcp)** | TeamCity CI/CD over MCP — builds, logs, tests, queue, configs, agents |
| **[design-system](./design-system)** | Versioned design context, four specialist roles, 31 workflows, offline sync, and a read-only MCP for Claude and Codex |
| **[plugin-rsync](./plugin-rsync)** | Rsync marketplace source into globally installed Claude/Grok/Codex caches (user-scope only) |

## Installation

```bash
/plugin marketplace add ByteDeskAI/bytedesk-marketplace
/plugin install platform-dev@bytedesk
/plugin install bytedesk-goals@bytedesk
```

`plugin-rsync` is **user-scope only** (`/plugin install plugin-rsync@bytedesk` in user settings, then `plugin-rsync/install.sh`). Do not enable it on a project.

Codex can install the dual-provider design plugin directly:

```bash
codex plugin marketplace add ByteDeskAI/bytedesk-marketplace --ref main
codex plugin add design-system@bytedesk
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
