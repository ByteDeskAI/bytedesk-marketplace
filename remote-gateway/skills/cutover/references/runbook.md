# Safe cutover runbook

## Develop-only source gate

Run build, stage, restart, deploy, and shadow-drill modes from a Gateway Git checkout
on the exact `develop` branch. Feature branches, `main`, detached HEAD, and product
homes without a Git checkout are refused before side effects. The same guard runs
in the repository script and the self-contained skill script; the PowerShell wrapper
delegates to the guarded Bash entrypoint. There is no force/skip override.

Merge the intended work into `develop` with operator authorization first. Verify it
is current with `origin/develop` and inspect dirty state before building. Do not switch
a peer's checkout or rename a feature branch to bypass the gate. An inherited
`BYTEDESK_EMOTE_GATEWAY_SOURCE_DIR` must point into that same checkout or be unset.
Read-only `preflight`, `postflight`, and help do not require `develop`.

This changes source-based cutover invocation; it does not retroactively replace
scripts in older worktrees or installed copies. Update those through the normal
delivery workflow before relying on their guard.

## Skill-local script

```bash
ROOT="${GROK_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
SKILL_DIR="${ROOT:+$ROOT/skills/cutover}"
SKILL_DIR="${SKILL_DIR:-<directory containing this SKILL.md>}"
DEPLOY="$SKILL_DIR/scripts/deploy-safe.sh"
```

Monorepo operators may use repo-root `scripts/deploy-safe.sh`. Agents use `$DEPLOY` only.

## Commands (source of truth)

**Default `/cutover` (always restarts):**

```bash
"$DEPLOY" preflight
"$DEPLOY" stage
"$DEPLOY" restart-cutover       # always after stage unless user said stage-only
# If stage.result=UNCHANGED but bounce still needed:
FORCE_RESTART=1 "$DEPLOY" restart-cutover
```

Other modes:

```bash
"$DEPLOY" verify-candidate
"$DEPLOY" stage                 # install binary only — opt-in “stage only / no restart”
"$DEPLOY" restart-cutover       # one restart + postflight
FORCE_RESTART=1 "$DEPLOY" restart-cutover
"$DEPLOY" postflight            # dual healthz + remote + terminal sleep I/O
"$DEPLOY" deploy                # stage + restart when binary changed
"$DEPLOY" shadow-fail-drill
```

`./cli stage` / `./cli deploy-safe` may wrap the same script — prefer the script path for agents.

**Agent rule:** do not stop after `stage` and ask for restart. Restart is part of default cutover.

## What each phase proves

| Phase | Proves |
|-------|--------|
| preflight | Live unit active, local healthz ok, remote or tunnel-status ok |
| verify-candidate | New binary boots on shadow port and answers healthz |
| stage | Candidate installed to live path; process still old code |
| restart-cutover | Process reloads binary; postflight dual healthz + remote + terminal probe |
| postflight | Live still dual-ok + remote + terminal sleep I/O after any change or no-op |
| deploy | Full pipeline; skips restart if binary hash UNCHANGED |
| shadow-fail-drill | Bad candidate rejected; live stays healthy |

## FORCE_RESTART

When last `stage.result` is `UNCHANGED` and live healthz is ok, `restart-cutover` **skips** restart (avoids public flaps). Use only when you need a real process bounce:

```bash
FORCE_RESTART=1 "$DEPLOY" restart-cutover
```

## Env vars

| Var | Default | Notes |
|-----|---------|--------|
| `BYTEDESK_EMOTE_GATEWAY_HOME` | `~/.bytedesk-emote-gateway` | Runtime home |
| `PUBLIC_PROBE_URL` | gateway public `/healthz` | External proof |
| `SKIP_REMOTE_PROBE` | `0` | Set `1` only if user accepts |
| `SKIP_TERMINAL_PROBE` | `0` | Set `1` only if user accepts degraded proof (terminals not verified) |
| `EVIDENCE_DIR` | `./_uptime_evidence` | Probe logs |
| `EVIDENCE_GC` | `1` | Set `0` to disable start-clear + hourly prune of evidence files |
| `EVIDENCE_MAX_AGE_MIN` | `60` | Regular files older than this many minutes are deleted hourly |
| `SHADOW_PORT` | `18443` | Candidate boot |
| `FORCE_RESTART` | unset | Force restart when UNCHANGED |
| `RESTART_TUNNEL_WATCHDOG` | `0` | On systemd, reload the tunnel watchdog after Gateway becomes ready, when a reviewed watchdog CLI update has been installed. Does not restart the connector. Requires an actual restart path; use `FORCE_RESTART=1` if stage is unchanged. |
| `GATEWAY_UNIT` | auto | Default commercial name; auto-switched to live unit when primary not active |
| `GATEWAY_UNIT_LEGACY` | `bytedesk-emote-gateway.service` | Preferred when fully active and primary is not |
| `GATEWAY_UNIT_FORCE` | unset | Force a specific unit name (skip auto-resolve) |

### Systemd unit resolution

Postflight/restart must not treat a crash-looping `bytedesk-gateway.service`
(`activating`) as the live unit when `bytedesk-emote-gateway.service` is
**active**. `deploy-safe` uses `is-active --quiet` and prefers a fully active
unit. Do **not** chain `is-active A || is-active B` inside `$(...)` — both can
print and yield `activating\nactive`, which fails `[[ == active ]]`.

## Success bar (walk-away checklist)

1. `postflight` exits 0  
2. Two local healthz samples = `ok`  
3. Unit `active` (the **resolved** gateway unit, usually emote on legacy homes)  
4. Remote `http_200` or `tunnel-status-public-ok`  
5. **Terminal probe PASS** — `GET /internal/cutover/terminal-probe` (loopback):  
   - `sleepIO=ok` (tmux `sleep 0.2` + printf token send-keys / capture-pane)  
   - `xtermAsset=ok` (embedded native terminal static)  
   - no dead durable term sessions (claude/codex/grok/kimi/pi/terminal)  
6. SPA reconnects (tabs durable via CAP-0021; banner CAP-0032 clear if tunnel ok)

If healthz is ok but terminals do not render or sleep I/O fails, **postflight fails** and cutover is not a success (restart-cutover rolls back to last-good when postflight fails after restart).

## Failure handling

- Shadow verify fail → live binary untouched; fix build/tests  
- Restart fail → script attempts last-good rollback  
- Postflight fail after restart → rollback path in script; re-run postflight after recovery  
- Remote fail only → check Funnel/tunnel-watchdog; local may still be ok  

## Agent anti-patterns

- Raw `systemctl --user restart` outside deploy-safe  
- **Stage-only default** — stopping after `stage` and waiting for “restart?” (restart is automatic)  
- Staging then force-restart without saying why (when FORCE_RESTART is used, say UNCHANGED + why bounce)  
- Claiming cutover PASS without postflight or preflight lines  
- Committing evidence dirs or gateway home  
- Ending a **feature** cutover PASS without **asking** `/commit` (prompt only — never auto-commit)  
- Auto-running `/commit` after cutover without operator agreement
