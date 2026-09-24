---
name: cutover
description: >
  Safe production cutover for bytedesk-remote-gateway via this skill's bundled
  scripts/deploy-safe.sh, only from the develop branch. DEFAULT always restarts: preflight → stage →
  restart-cutover → postflight (do not stage-only or ask for restart). Use
  FORCE_RESTART=1 when stage is UNCHANGED but bounce is still required. Also
  after every completed implementation task that changes gateway/SPA runtime.
  After feature cutover PASS, ask the operator to /commit (do not auto-commit).
  Triggers: /cutover, "safe cutover", "deploy-safe", "stage binary" (stage-only
  only if user says stage only / no restart), "restart cutover", FORCE_RESTART,
  postflight healthz.
---

# /cutover — safe gateway cutover

**Platforms:** Linux (systemd primary), macOS (launchd or pid), Windows (pid/`run.ps1` via Git Bash). Build, stage, and restart require a Gateway Git checkout on the exact `develop` branch. Product-home-only invocation is limited to read-only health checks.

Portable skill. **Do not invent deploy steps.** Only run this skill's bundled `scripts/deploy-safe.sh` (or `deploy-safe.ps1` on Windows). Prefer filesystem + shell tools. Resolve the skill directory and the approved `develop` checkout first.

## Releaseflow context (read first)

Commercial **artifact** publish is **TeamCity** (`docs/RELEASEFLOW.md` in the monorepo):
tag `v*` → `release-amd64`/`release-arm64` → `release-publish` → get.bytedesk.ai.
This skill is only **runtime host process cutover** (install binary on a machine +
**restart** the live process by default). It does **not** replace TeamCity publish
or invent a second production control plane. Dev default probe:
`https://gateway.dev.bytedesk.ai/healthz`.

## Canonical tools (skill-local)

Resolve the skill root (directory containing this `SKILL.md`). All commands use:

```bash
ROOT="${GROK_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
SKILL_DIR="${ROOT:+$ROOT/skills/cutover}"
SKILL_DIR="${SKILL_DIR:-<directory containing this SKILL.md>}"
DEPLOY="$SKILL_DIR/scripts/deploy-safe.sh"
# Windows: pwsh -File "$SKILL_DIR/scripts/deploy-safe.ps1" <mode>
```

| Path | Role |
|------|------|
| `$SKILL_DIR/scripts/deploy-safe.sh` | Bundled source of truth for preflight / stage / restart / postflight / deploy |
| `$SKILL_DIR/scripts/attach-cutover-evidence.sh` | CAP-0038: scan PASS evidence files → `tm evidence` (idempotent; `--dry-run`) |
| `$SKILL_DIR/references/runbook.md` | Mode details and env vars |
| `$SKILL_DIR/references/capability-hooks.md` | After PASS evidence hooks |
| `_uptime_evidence/` | Default probe logs (gitignored); cite as CAP evidence |
| `~/.bytedesk-emote-gateway/` or `~/.bytedesk-gateway/` | Live binary, `stage.result` (not in git) |

Load `references/runbook.md` and `references/capability-hooks.md` from this skill directory.

## Safety gates (non-negotiable)

0. **Only `develop` may cut over.** Before building or restarting, run `git branch --show-current` in the invoking Gateway checkout and require exactly `develop`. The script enforces this before any build, evidence cleanup, install, or service action. Feature branches, `main`, detached HEAD (even at `origin/develop`), and non-Git product homes are refused for `verify-candidate`, `stage`, `restart-cutover`, `deploy`, and `shadow-fail-drill`. `FORCE_RESTART` and skip flags do not bypass it. A source override must resolve to the same invoking checkout. `preflight`, `postflight`, and help remain available for diagnosis.
   - Finish feature work and obtain authorization to merge it into `develop` before cutover. Never silently switch a shared checkout, merge work, rename a feature branch to `develop`, or use a detached worktree as a workaround.
   - Verify `develop` is current with `origin/develop` and contains the intended commit. Inspect dirty state and stop if unrelated runtime edits would enter the build; branch membership alone does not prove clean or current source.
   - If merging, checkout ownership, or a Git lock blocks this, report the blocker. Do not deploy the feature checkout instead.
1. **`/cutover` always restarts by default.** Default path is `preflight` → `stage` → `restart-cutover` (postflight included). **Do not** stop after stage and ask “restart?” — restart is part of the skill unless the user explicitly said **stage only** / **no restart** / plan-dry-run.
2. **Operator standing order:** after every completed implementation task that changes gateway runtime surface, run the full cutover path once its changes are landed on `develop`. If they are not landed, request merge authorization first; the develop-only gate takes precedence over automatic cutover.
3. **UNCHANGED stage** → `restart-cutover` **skips** restart unless `FORCE_RESTART=1`. When `/cutover` or post-task cutover hits UNCHANGED but the change still needs a process bounce (env-only, drop-in, etc.), **automatically** use `FORCE_RESTART=1` and report it.
4. **Do not** set `SKIP_REMOTE_PROBE=1` unless the user accepts degraded external proof.
5. **Do not** commit `_uptime_evidence/`, binaries, `control.env`, or session stores.
6. If live healthz fails mid-flight, **stop** and report; do not improvise `systemctl restart` outside deploy-safe.
7. **Skip auto-cutover / skip restart** only for: pure docs / skills / AGENTS instruction edits with no runtime binary or SPA change; explicit “stage only” / “no restart”; plan/dry-run mode.
8. **After feature cutover PASS → ask `/commit`.** When this cutover landed a **feature** (post-task auto-cutover or user `/cutover` after implementation), **ask** the operator to run `/commit` (commit skill: changelog + human-only land + push). **Do not auto-run `/commit`.** Skip the ask only if there is nothing to land (clean tree / already committed) or the user already ordered commit/land in the same turn.

## Modes

Parse user intent → pick **one** mode. Show the plan, then execute.

| Mode | User phrases | Command | Restarts live? |
|------|--------------|---------|----------------|
| **`full` (default)** | `/cutover`, safe cutover, cut over, post-task auto | `preflight` + `stage` + `restart-cutover` (+ `FORCE_RESTART=1` if UNCHANGED needs bounce) | **Yes** |
| `plan` | plan, dry-run, rehearse, print commands only | *(skill-only — no shell)* | **No** — prints only |
| `preflight` | check health, preflight | `$DEPLOY preflight` | No |
| `verify` | shadow verify only | `$DEPLOY verify-candidate` | No |
| `stage` | **stage only**, install binary only, no restart | `$DEPLOY stage` | **No** (opt-in; not default) |
| `postflight` | dual healthz, remote, terminal sleep I/O, prove live | `$DEPLOY postflight` | No |
| `restart` | restart-cutover, cut over now (already staged) | `$DEPLOY restart-cutover` | **Yes** (unless UNCHANGED skip) |
| `force-restart` | FORCE_RESTART, force restart after UNCHANGED | `FORCE_RESTART=1 $DEPLOY restart-cutover` | **Yes always** |
| `deploy` | full deploy-safe | `$DEPLOY deploy` | **Yes** if binary changed |
| `drill` | shadow-fail-drill | `$DEPLOY shadow-fail-drill` | No |

### Plan / dry-run mode (CAP-0037)

When the user asks for **plan**, **dry-run**, or **rehearse** cutover (or `/cutover plan`):

1. **Do not execute** any deploy-safe command. **No restart.**
2. Print this copy-pasteable command list (from repo root):

```bash
# Resolve once
SKILL_DIR=…/skills/cutover
DEPLOY="$SKILL_DIR/scripts/deploy-safe.sh"

# 1) Health check only
"$DEPLOY" preflight

# 2) Build + shadow-verify + install binary (live process unchanged)
"$DEPLOY" stage

# 3) Apply staged binary (ALWAYS part of default /cutover — do not ask)
"$DEPLOY" restart-cutover

# 3b) If stage.result is UNCHANGED and bounce is still required:
FORCE_RESTART=1 "$DEPLOY" restart-cutover

# 4) Prove live (also runs inside restart-cutover)
"$DEPLOY" postflight

# Full loop (stages then restarts if binary changed)
"$DEPLOY" deploy
```

3. State explicitly: **no restart will run in plan mode**; production is untouched.
4. Note rules: never `systemctl restart` outside deploy-safe; never `SKIP_REMOTE_PROBE=1` unless accepted; capture evidence under `_uptime_evidence/`.

### Default full loop (`/cutover` with no args) — **always restarts**

1. `preflight`  
2. `stage`  
3. Report `stage.result` (`STAGED` vs `UNCHANGED`)  
4. **Always** run `restart-cutover` immediately (use `FORCE_RESTART=1` when UNCHANGED but bounce still required). **Never** stop after stage to ask for restart.  
5. Ensure **postflight PASS** (restart-cutover already runs it; re-run `postflight` if needed)  
6. Capability hooks (below)  
7. **Ask `/commit`** when this was feature work (see safety gate 8) — prompt only; wait for operator  

Same loop for post-task auto-cutover. Only skip restart when the user explicitly requested **stage only** / **no restart**, or this is plan/dry-run.

## Execution checklist

Before any command:

- [ ] For build/stage/restart, invoking checkout is on `develop`, contains the intended landed commit, and has no unrelated runtime edits
- [ ] Resolve `$SKILL_DIR` / `$DEPLOY` to this skill's bundled script
- [ ] `test -x "$DEPLOY"`
- [ ] Note `EVIDENCE_DIR` (default `./_uptime_evidence`)
- [ ] Default `/cutover` **includes restart** (brief SPA/session drop expected; no second confirmation)
- [ ] Explicit stage-only / no-restart: honor and do not restart

Run with adequate timeout (builds + shadow boot can exceed 2 minutes). Capture stdout/stderr in the reply.

On **non-zero exit**: print last evidence file under `_uptime_evidence/`, do not continue the loop.

On **PASS**:

1. Quote key lines: healthz, remote probe, **terminal probe** (sleepIO + live sessions), stage result, unit active  
2. Follow **capability hooks** in `references/capability-hooks.md` — run  
   `"$SKILL_DIR/scripts/attach-cutover-evidence.sh" [--dry-run] [CAP-ids…]` to attach  
   PASS postflight paths (CAP-0038; defaults open CAP-0026/CAP-0035)  
3. If stage-only by **explicit** user request: say so and do not restart; otherwise never leave a completed cutover staged without restart  
4. Never claim PASS if terminal probe failed — healthz alone is insufficient  
5. **Feature land prompt:** if this cutover followed feature/implementation work, **ask** the operator to run `/commit` (do not auto-commit). Example close: “Cutover PASS. Ready to land with `/commit`?”

## SPA / product notes

- Live restart drops browser EventSource and terminal iframes briefly; CAP-0021–0023 restore tabs/reconnect after cutover.
- Tunnel banner (CAP-0032) should clear when postflight remote probe is healthy.
- **Automatic console:** `deploy-safe` writes `cutover.job.json`. The SPA opens the procedure modal by itself (no standing header Cutover chip). On pass it holds success for 3s, then cache-busts `?_spa=` and returns to the original page.

## SPA Cutover CTA (CAP-0047)

The header chip appears only when a staged binary still needs attention. During a live job the modal is the UI.

1. GET `/admin/api/cutover` — status, stage.result, pending CAP changelog, job  
2. POST `/admin/api/cutover` `{ confirm, mode: restart-cutover, forceRestart, viaAgent }`  
3. Gateway **whitelist runner** executes only the host-installed deploy-safe path (product); agents use this skill's bundled script  
4. When `viaAgent: true`, also writes `GATEWAY_HOME/cutover.agent.request.md` + agentic handoff  

Same safety gates: no free-form shell, UNCHANGED skip unless force, postflight via deploy-safe.

## Related skills

- `commit` (`/commit`) — **ask** after feature cutover PASS; do not auto-run
- `release` (`/release`) — version ship (tag + CDN/GH verify) **before** a
  **release** cutover; this skill is host process only
- `enhance` / `enhance-track` / `enhance-refresh` — mark ops CAPs shipped with postflight evidence
- Do **not** invent a parallel deploy script; extend `deploy-safe.sh` only when product CAP requires it  

## Cross-terminal

Works on Claude, Grok, Codex, Kimi, Cursor: same shell + markdown store.  
Slash `/cutover` may be host-specific; natural language triggers are enough.
