# ADR-0002: All fleet state under `${CLAUDE_PLUGIN_DATA}` with per-project keying

## Status

Accepted - 2026-05-09

## Context

The first cut of the fleet plugin (extracted from `bytedesk-platform` PRs #346 / #347) wrote per-user state to `~/.claude-sessions/`, with files keyed by ticket: `<TICKET>.meta`, `<TICKET>.log`, `<TICKET>.events`, etc. The directory was created by `fleet/install.sh` (an out-of-band installer that also symlinked `bin/` into `~/.local/bin/` and installed systemd unit files).

This worked but had three load-bearing problems for a Claude Code plugin distribution:

1. **Shared-namespace pollution.** `~/.claude-sessions/` is a flat top-level directory in the user's home. Any other tool, plugin, or future fleet revision that wanted to write similarly-named files would collide. The plugin doesn't own its own data namespace.
2. **No multi-project isolation.** A single user can have multiple repos, each using overlapping ticket keys (`BDP-360` in repo A, `BDP-360` in repo B). The flat layout has them collide.
3. **Uninstall is messy.** `/plugin uninstall fleet@bytedesk` doesn't reach into `~/.claude-sessions/` to clean up; the user has to remember to `rm -rf ~/.claude-sessions/` themselves. The plugin owns code but not state, which violates least-surprise.

Claude Code injects two relevant environment variables into hooks, monitors, and PATH-injected scripts (verified in [research note 0001](../research/0001-plugin-manifest-lifecycle.md), citing [plugins-reference → Environment variables](https://code.claude.com/docs/en/plugins-reference)):

- `${CLAUDE_PLUGIN_ROOT}` — the plugin install dir (changes on plugin update).
- `${CLAUDE_PLUGIN_DATA}` — `~/.claude/plugins/data/<plugin-id>/`. Persists across plugin updates; cleared on uninstall.

`${CLAUDE_PLUGIN_DATA}` is the canonical answer to "where does this plugin's persistent state live."

## Decision

All fleet state lives under `${CLAUDE_PLUGIN_DATA}/projects/<PROJECT_KEY>/`. Not `~/.claude-sessions/`. Not `~/.local/bin/`. Not `~/.config/systemd/user/`. The plugin owns all its own state — `/plugin uninstall` results in a clean filesystem.

### Layout

```text
${CLAUDE_PLUGIN_DATA}/projects/<PROJECT_KEY>/
├── sessions/
│   └── <TICKET>/
│       ├── meta              key=value session metadata
│       ├── log               ANSI-stripped tmux pane output
│       ├── events            JSONL tool-level events (BDP-372)
│       ├── events.offset     daemon read offset
│       ├── events.err        hook error log
│       └── results/          parent-child file-passing dir
├── notify/
│   ├── pid                   daemon PID lock (BDM-4)
│   ├── config.toml           notification routing config
│   ├── log                   daemon error log
│   └── fifo                  named pipe for fifo sink
└── rules/
    ├── *.json                rules-engine pending rules
    └── log/                  rules-engine fired/cancelled/timed-out records
```

### `PROJECT_KEY` derivation

12-char prefix of `sha256sum` of the **canonical git working-tree root**:

```bash
_canonical_dir() {
  local gcd
  if gcd="$(git rev-parse --git-common-dir 2>/dev/null)" && [[ -n "$gcd" ]]; then
    dirname "$(realpath "$gcd")"
  else
    realpath "${CLAUDE_PROJECT_DIR:-$PWD}"
  fi
}
PROJECT_KEY=$(_canonical_dir | sha256sum | cut -d' ' -f1 | head -c 12)
```

`git rev-parse --git-common-dir` resolves to the **main repo's `.git`** dir from any worktree — including secondary worktrees under `<repo>/.claude/worktrees/<TICKET>-<slug>/`. So a fleet child running in a spawn-claude-feature-created worktree shares the parent's `PROJECT_KEY` and lands in the same dashboard. Outside any git tree, falls back to `CLAUDE_PROJECT_DIR` (Claude Code injects this) or `$PWD`.

12 hex chars = 48 bits of entropy; collision probability across a single user's repo set is negligible.

## Rationale

### Why `${CLAUDE_PLUGIN_DATA}` over `~/.claude-sessions/`

- **Plugin self-containment.** The data namespace belongs to *this* plugin. Other plugins or future fleet revisions can't collide.
- **Clean uninstall.** `/plugin uninstall fleet@bytedesk` removes `${CLAUDE_PLUGIN_DATA}` along with the plugin, no manual cleanup.
- **Documented contract.** [plugins-reference → Environment variables](https://code.claude.com/docs/en/plugins-reference) explicitly guarantees `${CLAUDE_PLUGIN_DATA}` in hooks, monitors, and bin-script contexts. We're standing on documented ground.

### Why per-project keying

- **Multi-project isolation.** A user with `bytedesk-marketplace` and `bytedesk-platform` checked out side-by-side now has truly separate fleet state. No collision on overlapping ticket keys.
- **Defensive design under undocumented monitor lifecycle.** Whether Claude Code spawns one monitor per session or shares across sessions in the same project is undocumented (see [research note 0001 → Q2](../research/0001-plugin-manifest-lifecycle.md#d-lifecycle-questions-q1q5)). Per-project keying makes the BDM-4 PID lock natural either way.
- **Worktree stability.** Using `git rev-parse --git-common-dir` means a fleet child running in a temporary worktree lands on the SAME `PROJECT_KEY` as the main checkout. That's what makes "spawn child → child opens PR → parent sees the events file" work as a flat operation.

### Why per-ticket directory grouping (`sessions/<TICKET>/`) instead of flat (`sessions/<TICKET>.<ext>` × 5)

- **Single-rm cleanup.** `claude-sessions kill <TICKET>` is now a single `rm -rf` of the directory. No risk of orphaning `events.offset` or `events.err` because they don't live alongside the meta file.
- **Easier inspection.** `ls $(_session_dir BDP-360)` shows everything related to one ticket in one place.
- **Future-proof.** Adding a sixth state file per ticket doesn't require touching the cleanup path.

### Why `notify/` and `rules/` get their own subdirs

- **Logical grouping.** `notify/{pid,config.toml,log,fifo}` is the daemon's directory, not session state. Mixing them in a flat directory was a v0.1 holdover.
- **Lock-file clarity.** The PID file at `notify/pid` (used by BDM-4) is colocated with the rest of the daemon's persistent state.

## Consequences

### Positive

- The plugin owns its data namespace; uninstall is clean.
- Multi-project users get true isolation.
- Worktree spawns inherit the right project automatically.
- The BDM-4 lock + stand-by design has a natural per-project home.

### Negative

- **State does NOT survive plugin uninstall.** `/plugin uninstall` clears `${CLAUDE_PLUGIN_DATA}`. This is intentional — uninstall should be uninstall — but users on the v0.1 path who run uninstall expecting `~/.claude-sessions/` to survive will be surprised. Documented in `fleet/docs/MIGRATION.md` (BDM-10).
- **State DOES survive plugin updates.** `${CLAUDE_PLUGIN_DATA}` persists across `/plugin update`. That's the documented behavior; no concern here.
- **No automatic migration from v0.1's `~/.claude-sessions/`.** Existing users start fresh on the new directory after upgrading. The old directory becomes orphan data the user can `rm -rf` after confirming they no longer need historical session logs.

### Neutral / operational

- Directories under `sessions/<TICKET>/` and `notify/` are created lazily by helper functions in `bin/claude-sessions`, `bin/spawn-claude-feature`, and `hooks/event-emitter.sh`. The script-load mkdir only creates `sessions/` and `rules/log/`.
- Outside a Claude Code session (ad-hoc CLI use), `${CLAUDE_PLUGIN_DATA}` is unset. Helpers fall back to `$HOME/.claude/plugins/data/fleet/` so manual invocation still works.

## References

- [research note 0001](../research/0001-plugin-manifest-lifecycle.md) — confirms `${CLAUDE_PLUGIN_DATA}` is documented in hooks, monitors, and PATH-injected bin scripts.
- BDM-3 — bin-script implementation of this layout.
- BDM-4 — daemon PID lock at `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/notify/pid`.
- BDM-10 — removal of `install.sh` and `fleet/systemd/` (the old `~/.claude-sessions/` deployment path).
