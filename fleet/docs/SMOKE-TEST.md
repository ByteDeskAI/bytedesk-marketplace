# Smoke test: end-to-end `/plugin install fleet@bytedesk`

This is the BDM-7 verification checklist. Run it on a fresh machine or sandbox where the `fleet` plugin has never been installed, in a Claude Code session that hasn't already added the marketplace.

The checklist is the single source of truth for "v1.0 is shippable." Anything that fails here either fixes in a follow-up PR before tagging, or moves to a follow-up ticket.

## Prerequisites

- A machine with `tmux`, `gh` (authed), `git ≥ 2.5`, `jq`, and `notify-send` (Linux) / equivalent.
- A fresh Claude Code install, OR an existing install with `fleet` not yet installed (verify: `/plugin list` shouldn't include `fleet@bytedesk`).
- A throwaway git repo to spawn into. Doesn't need to be a real ByteDesk repo — any repo with a `main` or `develop` branch works.

## Phase 1 — Install

```
/plugin marketplace add ByteDeskAI/bytedesk-marketplace
/plugin install fleet@bytedesk
```

Expected:

- [ ] Marketplace adds without errors. `/plugin marketplace list` shows `bytedesk`.
- [ ] Plugin installs without errors. `/plugin list` shows `fleet@bytedesk` enabled.
- [ ] `${CLAUDE_PLUGIN_ROOT}` resolves to `~/.claude/plugins/marketplaces/<...>/fleet/` (or similar plugin-managed path).

## Phase 2 — PATH-injected scripts

In a Bash shell inside the Claude Code session:

```bash
which claude-sessions          # → ${CLAUDE_PLUGIN_ROOT}/bin/claude-sessions
which spawn-claude-feature     # → same dir
claude-sessions help           # → prints usage; does NOT mention `claude-sessions service`
claude-sessions list           # → empty table; does NOT crash; creates state dir lazily
```

Expected:

- [ ] Both binaries on `$PATH`.
- [ ] `claude-sessions help` shows the trimmed usage block (no `service` subcommand mentioned).
- [ ] `claude-sessions list` runs cleanly; `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/sessions/` is created on first invocation.

## Phase 2b — Interactive-shell PATH wrapper (BDM-23)

In the Claude Code session, run `/fleet:setup-cli`. Then in a **fresh interactive zsh / bash shell** (a new terminal window — *not* the Claude Code tool host):

```bash
which claude-sessions          # → ~/.local/bin/claude-sessions
which claude-sessions-web      # → ~/.local/bin/claude-sessions-web
which spawn-claude-feature     # → ~/.local/bin/spawn-claude-feature
claude-sessions help           # → prints usage; resolves to the latest installed version
```

Expected:

- [ ] All three wrappers resolve to `~/.local/bin/<name>`.
- [ ] `claude-sessions help` succeeds — wrapper `exec`'s into the highest-version installed plugin's binary.
- [ ] Re-running `/fleet:setup-cli` reports each wrapper under `refreshed`, none under `created`, and never errors (idempotent).
- [ ] If a foreign file is pre-placed at `~/.local/bin/claude-sessions` (e.g. an old user-owned script), the skill skips it and reports it under `skipped` rather than overwriting.

## Phase 3 — Hook firing (depth 0 merge guard)

In a Bash shell at the throwaway repo root, simulate a non-authorized merge attempt. Substitute `99999` with a never-existing PR number; the hook should block before the gh call lands.

```bash
gh pr merge 99999
```

Expected:

- [ ] Hook fires with stderr: `🛑 merge-guard: PR #99999 is not explicitly authorized in the user's latest message.`
- [ ] Exit code is non-zero.
- [ ] Authorize via a follow-up message (`merge 99999`) and re-run — hook should let it through (gh will fail because the PR doesn't exist, but that's the gh layer, not the hook).

## Phase 4 — Monitor lifecycle (Q1–Q3 from BDM-6)

The undocumented questions from `fleet/docs/research/0001-plugin-manifest-lifecycle.md`. Open this Phase with a notepad — the answers determine whether `fleet/tests/test-notify-lock.sh`'s assumptions hold in the real Claude Code runtime.

### Q1: Monitors per session

In the Claude Code session, with the plugin enabled:

```bash
pgrep -af 'claude-sessions notify'
```

- [ ] Exactly **1** process running. Note the PID.

### Q2: Two sessions, same project

Open a **second** Claude Code session in the **same** project (same git repo). Plugin should auto-enable. Re-run `pgrep`:

```bash
pgrep -af 'claude-sessions notify'
```

- [ ] **Document the count.** If 2 processes: BDM-4's stand-by lock design is correct — one should be holding the PID file at `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/notify/pid`, the other should be polling. If 1 process: Claude Code shares monitors across sessions in the same project; the stand-by code path is dead and BDM-4 simplifies.
- [ ] Verify lock state: `cat ${CLAUDE_PLUGIN_DATA}/projects/$(claude-sessions help | grep -oE '[0-9a-f]{12}' | head -1)/notify/pid` shows the active PID.

### Q3: Signal on session-exit

Pick the active monitor's PID. Add a temporary signal-logging trap to the daemon (edit `${CLAUDE_PLUGIN_ROOT}/bin/claude-sessions`):

```bash
# Insert at the top of cmd_notify, after the depth check:
trap 'echo "got SIGTERM at $(date)" >> /tmp/fleet-sig.log; exit 0' TERM
trap 'echo "got SIGINT at $(date)" >> /tmp/fleet-sig.log; exit 0' INT
trap 'echo "got SIGHUP at $(date)" >> /tmp/fleet-sig.log; exit 0' HUP
```

Restart the monitor (close + reopen the Claude Code session, or restart the plugin via `/plugin reload fleet`). Then close the Claude Code session and check `/tmp/fleet-sig.log`.

- [ ] Document which signal fired. Adjust BDM-4's trap if it's not in {SIGTERM, SIGINT, SIGHUP}.

### Q4–Q5

These were rendered moot by BDM-6's discovery that `lifecycle` and `restart` aren't documented fields. The canonical `when: "always"` (already shipped) is the right answer. Verify the monitor actually starts at session start:

- [ ] After `/plugin install`, monitor starts within 5 seconds (visible in `pgrep`).

## Phase 5 — Slash commands resolve

In the Claude Code session:

```
/fleet:spawn
/fleet:review
/fleet:tournament
/fleet:chain
/fleet:wait
/fleet:cleanup
/fleet
```

- [ ] All seven discoverable in the slash-command picker.
- [ ] `/fleet` (the status skill, root invocation) shows the dashboard table.
- [ ] At least one — try `/fleet:spawn BDP-360` against a real ticket — actually spawns. Skip if no test Jira project available.

## Phase 6 — State directory layout

After spawning at least one session:

```bash
KEY=$(claude-sessions help | grep -oE '[0-9a-f]{12}' | head -1)
tree -L 3 "${CLAUDE_PLUGIN_DATA}/projects/${KEY}/" 2>/dev/null \
  || ls -la "${CLAUDE_PLUGIN_DATA}/projects/${KEY}/"
```

Expected:

- [ ] `sessions/<TICKET>/` exists with `meta`, `log`, `events.offset` (others lazy).
- [ ] `notify/{pid,config.toml}` exists.
- [ ] No flat `.meta` / `.log` files at the project-dir level.

## Phase 7 — Worktree-stable PROJECT_KEY

If the spawn succeeded, find the worktree it created (under `<repo>/.claude/worktrees/<TICKET>-<slug>/`). In a shell `cd`'d into the worktree, derive the PROJECT_KEY using the same helper:

```bash
gcd=$(git rev-parse --git-common-dir)
canonical=$(dirname "$(realpath "$gcd")")
echo "$canonical" | sha256sum | cut -d' ' -f1 | head -c 12
```

- [ ] PROJECT_KEY in the worktree matches the one in the main checkout. (If different, the helper's `--git-common-dir` resolution has a bug — file as a follow-up.)

## Phase 8 — Cleanup

- [ ] Restore the daemon if you edited it for Q3 signal logging.
- [ ] Kill any test sessions: `claude-sessions kill <TICKET>`.
- [ ] `/plugin uninstall fleet@bytedesk` — confirm `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/` is reclaimed.

## Reporting

If everything passes, mark BDM-7 Done. If anything fails:

- For pass/fail-flags, leave them unchecked here and capture in a Jira comment.
- For Q2 / Q3 answers, edit `fleet/docs/research/0001-plugin-manifest-lifecycle.md` to upgrade the lifecycle questions from "not documented" to "verified empirically" with the actual answer.
- For unexpected failures, file follow-up tickets and link them to BDM-7.

## Out of scope

- Cross-machine coordination (federated fleet).
- Performance benchmarking under load.
- Verifying systemd-fallback path — the path is gone (BDM-10).
