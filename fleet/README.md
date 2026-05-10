# fleet

Parallel multi-session Claude orchestration as a Claude Code plugin.

Spawn agents on tickets, run them in parallel git worktrees, watch a dashboard, get push notifications when reviews land or merges happen. Hierarchical authorization with depth-aware delegation lets parent agents delegate to children safely without per-action friction.

## Install

Add the [bytedesk-marketplace](https://github.com/ByteDeskAI/bytedesk-marketplace) and install:

```
/plugin marketplace add ByteDeskAI/bytedesk-marketplace
/plugin install fleet@bytedesk
```

Per-session state lives under `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/` and is created lazily on first use; see [ADR-0002](./docs/adr/0002-plugin-data-directory.md). Coming from the v0.1 install.sh path? See [docs/MIGRATION.md](./docs/MIGRATION.md).

### After install

Run `/fleet:setup-cli` once to add `claude-sessions`, `claude-sessions-web`, and `spawn-claude-feature` to your interactive shell `PATH`. It writes thin wrappers to `~/.local/bin/` that resolve to the latest installed plugin version at exec time, so they survive `/plugin update fleet@bytedesk`. Without this step the binaries are only on the Claude Code tool host's PATH (skills work) but not on your terminal's PATH (`claude-sessions attach <TICKET>` returns `command not found`).

## What's in the box

| Component | Purpose |
|---|---|
| `bin/claude-sessions` | Dashboard + control plane CLI. List sessions, attach, send messages, kill, query events. Auto-PATH'd via `${CLAUDE_PLUGIN_ROOT}/bin/`. |
| `bin/spawn-claude-feature` | Worktree + tmux session launcher with full-auto, parent tracking, depth-aware spawning. |
| `hooks/pr-merge-guard.sh` | PreToolUse hook — blocks `gh pr merge` without per-PR authorization at depth 0; delegates at depth ≥ 1 (ADR-0001). |
| `hooks/event-emitter.sh` | PostToolUse hook — emits structured JSONL events for `gh pr review`, `gh pr merge`, `git push` etc. |
| `monitors/monitors.json` | Registers the `claude-sessions notify` daemon as a plugin-managed monitor; per-project PID lock + stand-by polling so multiple sessions in the same project coordinate cleanly (ADR-0002, BDM-4). |
| `skills/{spawn,review,cleanup,tournament,wait,chain}/` | Slash commands: `/fleet:spawn`, `/fleet:review`, etc. |

## Worktree isolation

Every spawned session runs in a **fresh git worktree** at `<repo>/.claude/worktrees/<TICKET>-<slug>/`. That worktree is a clean checkout: no shared `node_modules/`, `bin/obj/`, `.next/`, `.venv/`, or other dep/build state from the parent tree. Wrapper skills that write prompts for `/fleet:spawn` must include the right install/restore step (`npm install`, `dotnet restore`, `uv sync`, etc.) before any build or test command. See [`/fleet:spawn`](./skills/spawn/SKILL.md) → "What spawning gives you" for the full set of consumer-relevant facts (worktree isolation, `--full-auto` semantics, `--prompt-file` rationale).

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

`v1.3.0` (2026-05-10) — web dashboard read surface (BDM-14 Phase 3a): real `/api/*` endpoints (sessions, stats, projects, events) + polling hooks. SPA renders live data from `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/sessions/`. SSE multiplex (Phase 3b) + PTY embed (Phase 4) + actions (Phase 5+) are next. Extracted from `ByteDeskAI/bytedesk-platform` and reshaped into a Claude-Code-native plugin (per-project state under `${CLAUDE_PLUGIN_DATA}`, plugin-managed monitor, no install.sh). Coming from v0.1? See [`docs/MIGRATION.md`](./docs/MIGRATION.md).

## License

[MIT](../LICENSE)
