# bytedesk-marketplace

ByteDesk's Claude Code marketplace. Plugins for parallel multi-session orchestration, hierarchical authorization, and developer tooling.

## Plugins

| Plugin | Description |
|---|---|
| **[fleet](./fleet)** | Parallel multi-session Claude orchestration. Spawn agents on tickets, run them in parallel git worktrees, watch a dashboard, get push notifications when reviews land or merges happen. Hierarchical authorization (ADR-0001) lets parent agents delegate to children safely. |

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

`v1.4.1` (2026-06-03) — design-patterns plugin v0.9.1 (PostToolUse hook support for `search_replace` tool used by agentic edits); OAuth fixes and self-contained PKCE + loopback token intercept in the companion bytedesk-terminal (no more paste, env + ~/.grok/auth.json inheritance). The `fleet` plugin's v0.1 → v1.0 migration is documented at [`fleet/docs/MIGRATION.md`](./fleet/docs/MIGRATION.md).

## License

[MIT](./LICENSE)
