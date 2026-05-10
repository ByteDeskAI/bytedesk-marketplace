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

`v1.0.0` (2026-05-09) — first public release. The `fleet` plugin's v0.1 → v1.0 migration is documented at [`fleet/docs/MIGRATION.md`](./fleet/docs/MIGRATION.md).

## License

[MIT](./LICENSE)
