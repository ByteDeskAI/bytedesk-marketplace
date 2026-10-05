---
name: setup-agent-orchestration
description: Prepare a machine for tmux-hosted multi-agent orchestrations — verify or install tmux for the OS, inventory installed agent CLIs against the provider adapters, create the user workflow and adapter folders, and register any extra CLI as an adapter, and wire Claude Code, Codex, Grok Build or Kimi as an orchestration host (formerly the install-orchestration-host skill). Use on a new machine, when `ao-topology doctor` reports problems, when the user wants to add a CLI as an agent, or when enabling Grok or Kimi as the orchestrator, installing host MCP and skills, or making Codex or Claude load the same control plane.
user-invokable: true
argument-hint: "[--add-cli <command>] [--host grok|kimi|codex|claude|all] [--dry-run]"
---

# Set up agent orchestration on this machine

Resolve `AO` as `../../bin/ao-topology` relative to this skill.

## 1. Diagnose

Run `AO doctor` and read it as a checklist. It reports the OS (and whether this is WSL2), the
package manager, tmux, node, every known CLI with its path and version, the search paths for
workflows/skills/roles/providers, and a `Problems` list with the exact fix command per problem.

## 2. tmux

- Present → nothing to do.
- Missing on Linux or macOS → show the user the install command from the doctor output and run
  it only after they agree (it needs sudo or Homebrew).
- Native Windows → tmux does not run there. Explain the two routes and let the user choose:
  WSL2 (`wsl --install`, then install tmux and every agent CLI inside the distribution and run
  `ao-topology` from there) or MSYS2 (`pacman -S tmux`, with CLIs installed into that
  environment). WSL2 is the recommended route; note that the user's Windows-installed CLIs are
  not visible inside WSL unless reinstalled there.

Recommended `~/.tmux.conf` lines for readable multi-agent sessions (offer, do not impose):

```
set -g mouse on
set -g pane-border-status top
set -g pane-border-format " #{?@ao_role_icon,#{@ao_role_icon} #{@ao_agent} · #{@ao_role_label},#{pane_title}} "
set -g history-limit 50000
```

The border line shows each managed pane's role icon, readable name and role label, and falls back
to the pane title on panes agent orchestration did not create. Those `@ao_*` pane options are
display-only; the terminal title bar of a session agent orchestration creates already shows the
active pane's icon without any of these lines.

## 3. Agent CLIs

For each CLI the user wants as an agent, the doctor shows ready (on PATH) or the install hint.
Authentication is the CLI's own business: after installing, the user runs its login once in a
normal terminal. Never store keys in specs, adapters, or workflows.

## 4. Folders

Create, if missing, `~/.config/agent-orchestration/{workflows,providers,roles,skills}`. Workflows
saved with `--save user` land in `workflows/`; a JSON in `providers/` overrides or adds an adapter;
a Markdown file in `roles/` overrides or adds a role pack; `skills/` holds skills the user wants
available to agents on every run.

Runs need no `.gitignore` entry in the consumer: `.bytedesk/agent-orchestration/runs/` ignores
itself from the first run onward.

## 5. Add a CLI as an adapter (`--add-cli <command>`)

1. Confirm the command exists: `which <command>`; run `<command> --help` and read the flags.
2. Copy `providers/generic.json` from the plugin to `~/.config/agent-orchestration/providers/<command>.json`.
3. Fill in: `id` and `command`; `model_args` if there is a model flag; `system_prompt_args` if
   there is a system-prompt or instructions flag (use the `{{system_prompt}}` placeholder);
   `auto_approve_args` for its non-interactive/yolo mode; `detect` as `[command, "--version"]`;
   a `ready.pattern` regex matching the CLI's idle prompt on screen (test it with
   `tmux capture-pane -p` while the CLI is idle — trailing spaces are trimmed); and `notes`.
4. Verify: `AO providers` lists it; `AO doctor` shows it ready.
5. Smoke test with a one-agent spec (`role: orchestrator`, `cli: <command>`) and `AO launch --dry-run`,
   then a real launch, then `AO stop`.

## 6. Managed processes

The session host, the local NATS server and each repository supervisor run under process-compose.
Act on them only through their names:

- `agent-orchestration services status --json` — every managed process with its pid, state,
  restart count and readiness.
- `agent-orchestration services wait --until healthy` (or `--until <name> running`) `[--timeout <s>]` —
  blocks until the condition holds, then prints one JSON line; exit 0 met, 2 timed out, 1 bad
  argument. Use it after `ensure` or `restart` instead of a `sleep` loop around `status`.
- `agent-orchestration services restart <name>` / `agent-orchestration services stop <name>` —
  exactly that process, through the process-compose API; an unknown name is refused.

Never `pkill`, `pgrep` or `kill` these by name or command line: unrelated `nats-server` processes
(microk8s, for one) exist on dev machines, and process-compose restarts a killed child anyway.

The local NATS listens on `nats.port` from `~/.config/agent-orchestration/config.json`
(`$XDG_CONFIG_HOME` if set). ao writes it on the first start and keeps it; `services status --json`
shows it as `nats.url`. If `nats.conflict` is set, another process holds that port: stop it, or set
a different `nats.port` (an integer from 1024 to 65535) and run `agent-orchestration services ensure`.
ao ignores the generic `NATS_URL`; use `AO_NATS_URL` to point ao at another server.

### Secrets workers need

Name them in the repository config, never their values:

```json
{ "workers": { "passEnv": ["TYPESAFE_API_KEY"] } }
```

in `.bytedesk/agent-orchestration/config.json` (or the global layer; `ao-topology config set`
writes either). When a run agent or a durable session starts, ao copies each named variable from
the launching environment into a 0600 file beside the launcher, which the launcher sources and
deletes. The value never enters the launcher, `run.json`, the journal, a prompt, tmux's
environment or any argv. A name the launching environment lacks is warned about by name, and the
launch continues. Never use `tmux set-environment -g` for a secret: every pane on the server
inherits it.

## 7. Wire another host (`--host`)

This step was the `install-orchestration-host` skill until TM-377.

Claude Code and Codex already load this plugin from their manifests. Grok Build and Kimi Code need
explicit host wiring so they can call `orchestration_*` and spawn the other CLIs. Delegates are
still trusted catalog IDs only: `claude`, `codex`, `grok-build`, `kimi`. Do not spawn an arbitrary
PATH command; add a new CLI through `docs/EXTENDING.md`.

1. Resolve the installed plugin root (this skill's `../../`). Do not assume the marketplace source
   checkout unless that is the installed copy.
2. Preview first:

   ```sh
   node skills/setup-agent-orchestration/scripts/install-host.mjs --dry-run --all
   ```

3. Apply the hosts the user named (`--host grok`, `--host kimi`, or `--all`).
4. Confirm:
   - Grok: `grok plugin details agent-orchestration` lists skills and MCP servers.
   - Kimi: `~/.kimi-code/mcp.json` contains `agent-orchestration` pointing at `bin/agent-orchestration-mcp`.
   - Codex: `~/.codex/config.toml` has `[plugins."agent-orchestration@bytedesk"] enabled = true`.
   - Claude: project or user plugin enablement includes `agent-orchestration@bytedesk`.
5. The script ends by refreshing every OLDER installed copy (Codex cache, Grok install, the root
   Kimi's `mcp.json` names) from this plugin root, so every host runs one ao build. It refuses a
   source with uncommitted changes, a copy inside a git checkout, and a copy whose `node_modules`
   does not satisfy the new `package.json`; report any such line to the user with its fix.
6. Tell the user to start a **fresh** host session. Existing sessions will not see new MCP servers.

Do not print tokens, rewrite unrelated MCP servers, or edit Orca-managed Kimi hook blocks.

## 8. Confirm

Run `AO doctor` again and report the line `OK — ready to launch.` or the remaining problems.
