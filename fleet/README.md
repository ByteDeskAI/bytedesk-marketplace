# fleet

Parallel multi-session Claude orchestration as a Claude Code plugin.

Spawn agents on tickets, run them in parallel git worktrees, watch a dashboard, get push notifications when reviews land or merges happen. Hierarchical authorization with depth-aware delegation lets parent agents delegate to children safely without per-action friction.

## Install

Add the [bytedesk-marketplace](https://github.com/ByteDeskAI/bytedesk-marketplace) and install:

```
/plugin marketplace add ByteDeskAI/bytedesk-marketplace
/plugin install fleet@bytedesk
```

After install, run the out-of-band installer once for the per-user state directory:

```
~/.claude/plugins/fleet/install.sh
```

This symlinks `bin/claude-sessions` and `bin/spawn-claude-feature` into `~/.local/bin/` and installs the systemd user units. Per-session state lives under `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/` (created lazily on first use; see [ADR-0002](./docs/adr/0002-plugin-data-directory.md)).

> **Going away in v1.0:** the `install.sh` + systemd path is being removed in favor of plugin-managed deployment (BDM-10). New installs should rely on `/plugin install fleet@bytedesk` alone.

## What's in the box

| Component | Purpose |
|---|---|
| `bin/claude-sessions` | Dashboard + control plane CLI. List sessions, attach, send messages, kill, query events. |
| `bin/spawn-claude-feature` | Worktree + tmux session launcher with full-auto, parent tracking, depth-aware spawning. |
| `hooks/pr-merge-guard.sh` | PreToolUse hook — blocks `gh pr merge` without per-PR authorization at depth 0; delegates at depth ≥ 1 (ADR-0001). |
| `hooks/event-emitter.sh` | PostToolUse hook — emits structured JSONL events for `gh pr review`, `gh pr merge`, `git push` etc. |
| `monitors/monitors.json` | Registers the `claude-sessions notify` daemon as a plugin-managed monitor (replaces systemd for users on the plugin path). |
| `skills/{spawn,review,cleanup,tournament,wait,chain}/` | Slash commands: `/fleet:spawn`, `/fleet:review`, etc. |
| `systemd/` | systemd user units for OS-level service lifecycle (alternative to running the daemon as a Claude Code monitor). |

## Slash commands

```
/fleet:spawn <BDP-N> [BDP-M ...]    # spawn one or many agents on tickets
/fleet:review <BDP-N>               # spawn a code reviewer for a session's PR
/fleet:tournament <BDP-N> N         # spawn N variant agents on the same ticket, judge picks the best
/fleet:chain                         # multi-stage dependency-aware orchestration
/fleet:wait                          # block until sessions reach a target state
/fleet:cleanup                       # sweep sessions whose PRs have merged
```

## CLI

```
claude-sessions                       # list all sessions
claude-sessions watch                 # live-update the dashboard
claude-sessions tree [<TICKET>]       # parent → child hierarchy
claude-sessions cost [<TICKET>]       # token usage and rough cost
claude-sessions events <TICKET> [--since=TS] [--kinds=K,..] [--json|--follow]
                                      # tool-level events for a session
claude-sessions notify                # daemon (run automatically when plugin enabled)
claude-sessions web                   # ttyd browser dashboard
```

## Authorization model

See [`docs/adr/0001-hierarchical-authorization.md`](./docs/adr/0001-hierarchical-authorization.md). Summary:

| Class | Examples | Auth rule |
|---|---|---|
| Local-blast | file edits, commits, lints | No gate |
| PR-level | open PR, comment, review, merge, label | Depth-aware: depth 0 → human in transcript; depth ≥ 1 → inherited from spawn |
| Repo-destructive | force push, branch delete, history rewrite | Always require human |
| External | production deploy, secret rotation | Always require human + per-action explicit auth |

## Event observability

See [`docs/RULES.md`](./docs/RULES.md) → "Event observability". Sessions emit structured events to `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/sessions/<TICKET>/events`; the notify monitor tails them and dispatches notifications via configurable sinks (desktop, bell, fifo, slack). See [ADR-0002](./docs/adr/0002-plugin-data-directory.md) for the full state-directory layout and `PROJECT_KEY` derivation.

## State directory

All fleet state lives under `${CLAUDE_PLUGIN_DATA}` — the plugin owns its own namespace, so `/plugin uninstall fleet@bytedesk` cleans up completely.

```text
${CLAUDE_PLUGIN_DATA}/projects/<PROJECT_KEY>/
├── sessions/<TICKET>/{meta,log,events,events.offset,events.err,results/}
├── notify/{pid,config.toml,log,fifo}
└── rules/{*.json,log/}
```

`PROJECT_KEY` is a 12-char `sha256` prefix of the canonical git working-tree path, resolved via `git rev-parse --git-common-dir` so secondary worktrees (e.g. fleet-spawned children at `<repo>/.claude/worktrees/<TICKET>-<slug>`) share the parent repo's key. To inspect:

```bash
# Where am I?
echo "$CLAUDE_PLUGIN_DATA/projects/$(claude-sessions help | grep -oE '[0-9a-f]{12}' | head -1)"
# All projects with fleet state on this machine:
ls "$CLAUDE_PLUGIN_DATA/projects/"
```

Full design rationale + trade-offs in [ADR-0002](./docs/adr/0002-plugin-data-directory.md).

## Dependencies

- `tmux`
- `gh` (GitHub CLI)
- `git` (worktree support, ≥ 2.5)
- `jq`
- `notify-send` (`apt install libnotify-bin` on Linux) — for desktop sink
- `ttyd` (optional) — for the web dashboard
- `curl` (optional) — for the slack sink

## Status

`v0.1.0` — pre-release. Extracted from `ByteDeskAI/bytedesk-platform`. Expect breaking changes until `v1.0.0`.

## License

[MIT](../LICENSE)
