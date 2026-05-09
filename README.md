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

`v0.1.0` — pre-release. Currently extracting from `ByteDeskAI/bytedesk-platform`. Expect breaking changes until `v1.0.0`.

## License

[MIT](./LICENSE)
