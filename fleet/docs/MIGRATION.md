# Migration: v0.1 install.sh path → plugin-managed deployment

If you installed the `fleet` plugin via the v0.1 `install.sh` workflow (`~/.local/bin/` symlinks + systemd user units + `~/.claude-sessions/` state directory), this migration takes you to the v1.0 plugin-only path. The OS-level installer is gone; everything now lives inside the Claude Code plugin runtime.

## Breaking changes

1. **`install.sh` removed.** The script that symlinked `bin/claude-sessions` and `bin/spawn-claude-feature` into `~/.local/bin/`, copied systemd units into `~/.config/systemd/user/`, and ran `systemctl --user enable --now ...` is gone. Plugin install via `/plugin install fleet@bytedesk` is the only deployment path.
2. **`fleet/systemd/` removed.** `claude-sessions-notify.service` and `claude-sessions-web.service` no longer ship. The notify daemon now runs as a plugin-managed monitor (`monitors/monitors.json`) with a per-project PID lock + stand-by polling pattern (BDM-4); the web dashboard runs on demand via `claude-sessions web`.
3. **`claude-sessions service` subcommand removed.** It existed only to wrap `systemctl --user`. Without systemd units there's nothing to wrap.
4. **State directory moved.** `~/.claude-sessions/` is no longer the state location. Per-session state now lives at `${CLAUDE_PLUGIN_DATA}/projects/<PROJECT_KEY>/sessions/<TICKET>/` (see [ADR-0002](./adr/0002-plugin-data-directory.md)).

## Migration steps

Run these on each machine that has v0.1 installed:

```bash
# 1. Stop the systemd services.
systemctl --user disable --now claude-sessions-notify claude-sessions-web

# 2. Remove the bin symlinks.
rm -f ~/.local/bin/claude-sessions ~/.local/bin/spawn-claude-feature

# 3. Remove the systemd unit files.
rm -f ~/.config/systemd/user/claude-sessions-notify.service \
      ~/.config/systemd/user/claude-sessions-web.service
systemctl --user daemon-reload

# 4. Install the plugin (or update if already installed).
#    Run inside Claude Code:
#      /plugin marketplace add ByteDeskAI/bytedesk-marketplace   (if not already added)
#      /plugin install fleet@bytedesk
```

After step 4 the plugin's monitor (`claude-sessions notify`, registered in `monitors/monitors.json`) will start automatically when any Claude Code session has the plugin enabled, and `claude-sessions` / `spawn-claude-feature` will be on `$PATH` via `${CLAUDE_PLUGIN_ROOT}/bin/`.

## State directory: do you need to migrate `~/.claude-sessions/`?

**No automatic migration is provided.** v1.0 starts fresh on `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/`. The old `~/.claude-sessions/` directory becomes orphan data. Choose one:

- **Keep the history** — leave `~/.claude-sessions/` in place for forensics. Nothing reads it after v1.0; it's just disk space (typically a few MB per session).
- **Reclaim the space** — once you've confirmed no in-flight session was running at the time of upgrade:
  ```bash
  rm -rf ~/.claude-sessions/
  ```

If you have an in-flight session (the tmux session is still running and the agent is mid-task), do NOT delete `~/.claude-sessions/` — kill the tmux session first via `tmux kill-session -t <session>`, then clean up. v0.1 sessions can't be migrated to v1.0 in place; let them finish on the v0.1 path or kill them and respawn under v1.0.

## Verifying the migration

```bash
# Confirm v0.1 services are gone:
systemctl --user status claude-sessions-notify   # should report "could not be found"
systemctl --user status claude-sessions-web      # should report "could not be found"

# Confirm v1.0 binaries are on PATH (inside a Claude Code session):
which claude-sessions                            # ${CLAUDE_PLUGIN_ROOT}/bin/claude-sessions
which spawn-claude-feature                       # same dir

# Confirm v1.0 state directory is in use after spawning a session:
ls "$CLAUDE_PLUGIN_DATA/projects/"               # one or more 12-char hex dirs
```

## Why the change

- **Plugin self-containment.** v0.1 spread state across `~/.claude-sessions/`, `~/.local/bin/`, and `~/.config/systemd/user/`. None of those are owned by the plugin, so `/plugin uninstall` couldn't clean up. v1.0 puts everything under `${CLAUDE_PLUGIN_DATA}` and `/plugin uninstall` reclaims it all.
- **Multi-project isolation.** v0.1 was flat: `BDP-360` in repo A and `BDP-360` in repo B collided. v1.0 keys state by canonical git working-tree path, so different repos get different state dirs automatically.
- **No OS dependency.** v0.1 required systemd-user. v1.0 runs as a plugin-managed monitor on whatever platform Claude Code supports.

Full design rationale: [ADR-0002](./adr/0002-plugin-data-directory.md). Manifest + lifecycle research that informed the design: [research note 0001](./research/0001-plugin-manifest-lifecycle.md).
