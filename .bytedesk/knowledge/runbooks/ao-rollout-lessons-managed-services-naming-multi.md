---
type: runbook
title: "ao rollout lessons: managed services, naming, multi-host installs (2026-10-01/02)"
description: Problems hit while moving agent-orchestration onto process-compose services and ADR-0030 naming, each with its fix or tracking task; read before changing ao setup, services or tests
tags:
  - agent-orchestration
  - lessons
status: stable
generated:
  by: knowledge-management/0.1.0
  at: 2026-10-02T03:46:43.353Z
tasks:
  - TM-272
  - TM-277
  - TM-283
  - TM-284
  - TM-285
  - TM-286
  - TM-281
---

# ao rollout lessons: managed services, naming, multi-host installs (2026-10-01/02)

Problems hit on the authoring machine while moving agent-orchestration (ao) onto process-compose services and ADR-0030 naming. Every new developer machine can hit them too. Each one names its fix, or the task that folds the fix into ao's automatic setup: the SessionStart `services ensure`, `doctor`, and the install-host and setup skills.

## How to use this page

- **Before changing ao setup, services or tests:** read the table and the rules below.
- **When you hit a new problem:** add a row and file a `tm` task. Fold its detection or repair into the automatic setup task, not into a one-off fix.

## Problems and where each fix lives

| # | Problem | Symptom | Fix / task |
|---|---|---|---|
| 1 | The session host ran unsupervised: a 24-hour `systemd-run` scope, or started by hand | Gateway shows `ACP_CONTROL_UNAVAILABLE` | TM-272: process-compose under a user-level OS registration, with `services ensure`. Gateway TM-457 runs ensure itself |
| 2 | Clean-install tests leaked `agent-orchestration-session-*.scope` units | Old session hosts on `/tmp/ao-clean-install-*` state roots | TM-272 test fix. Self-heal for old leaks: TM-285 |
| 3 | Old `ao-supervise` plugin monitors in long-lived sessions fought the managed supervisor | The supervisor that loses the lock restarts every 3 s | Ends when those sessions restart. Detection: TM-285 |
| 4 | The supervisor crashed on a NATS JetStream `TIMEOUT` | Supervisor exits 1 when nats-server restarts | TM-277 |
| 5 | A service-managed process started a second nats-server on the same JetStream store | Two servers; `state.json` rewritten | TM-277 guard |
| 6 | `services ensure` flapped between equivalent plugin copies (cache vs directory-marketplace source tree), and an older session could downgrade the services | All managed processes restart on every session start | TM-283 (0.13.2): the pointer follows the build fingerprint and version |
| 7 | Codex and Grok ao copies stayed at 0.11.0 while Claude ran 0.13.x | Mixed builds disagree on naming and identity | Fixed by hand with `plugin-rsync agent-orchestration`. Automatic: TM-284 |
| 8 | Long-lived sessions keep an old ao MCP server in memory | 19 ao MCP processes from builds days old were running | Restart those sessions. Detection: TM-285 |
| 9 | A project-scope `enabledPlugins` entry for a bytedesk plugin blocks every `git commit` (guard-project-install) | `FAIL …/.claude/settings.json: enables task-management@bytedesk` at commit time | Remove the project entry (user scope already enables it). Early warning: TM-285 |
| 10 | Real-tmux tests used the operator's default tmux server | Risk of INCIDENT-2026-09-09 (37 sessions destroyed) | TM-281: helper plus preflight; the suite now isolates itself |
| 11 | A long `TMUX_TMPDIR` exceeds the unix-socket path limit (~108 bytes) | Every tmux call fails with "File name too long" | Use a short `/tmp/aot-XXXX`. Doctor check: TM-285 |
| 12 | Killing by process name matched unrelated microk8s `nats-server -c /etc/nats/nats.conf` | Near-miss on cluster NATS pods | Never `pgrep`/`pkill` managed processes. Verbs: TM-286 (`services restart/stop <name>`) |
| 13 | Collision suffixes (`-2`) are meaningless across hosts | Names don't survive distributed teams | ADR-0030 and TM-274 (0.13.0); registry TM-279; handoff TM-280 |
| 14 | macOS workers fell through to systemd | Runs couldn't start on a Mac | TM-273: darwin backend, which fails closed. Sandbox: TM-282 |

## Rules that came out of this

- **Directory marketplaces hide delivery problems.** Claude sessions on the authoring machine run ao from the source tree. Verify against the installed cache, and against the Codex and Grok copies, not only the source tree.
- **Identify code by build, not by path.** Any "has it changed?" check compares the build fingerprint and version.
- **Act on managed processes only through `services`.** Never by name pattern.
- **Run every tmux-touching test isolated.** Since TM-281 the suite does this itself; keep `TMUX_TMPDIR` short.
- **Never edit a hash-locked presence contract in place.** Write an additive addendum plus a countersignature request (see `topology/PRESENCE-ROLE-ICON-ADDENDUM.md`).
