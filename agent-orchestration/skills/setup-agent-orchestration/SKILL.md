---
name: setup-agent-orchestration
description: Prepare a machine for tmux-hosted multi-agent orchestrations — verify or install tmux for the OS, inventory installed agent CLIs against the provider adapters, create the user template and adapter folders, and register any extra CLI as an adapter. Use on a new machine, when `ao-topology doctor` reports problems, or when the user wants to add a CLI as an agent.
user-invokable: true
argument-hint: "[--add-cli <command>]"
---

# Set up agent orchestration on this machine

Resolve `AO` as `../../bin/ao-topology` relative to this skill.

## 1. Diagnose

Run `AO doctor` and read it as a checklist. It reports the OS (and whether this is WSL2), the
package manager, tmux, node, every known CLI with its path and version, the search paths for
templates/skills/roles/providers, and a `Problems` list with the exact fix command per problem.

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
set -g pane-border-format " #{pane_title} "
set -g history-limit 50000
```

## 3. Agent CLIs

For each CLI the user wants as an agent, the doctor shows ready (on PATH) or the install hint.
Authentication is the CLI's own business: after installing, the user runs its login once in a
normal terminal. Never store keys in specs, adapters, or templates.

## 4. Folders

Create, if missing, `~/.config/agent-orchestration/{templates,providers,roles,skills}`. Templates
saved with `--save user` land in `templates/`; a JSON in `providers/` overrides or adds an adapter;
a Markdown file in `roles/` overrides or adds a role pack; `skills/` holds skills the user wants
available to agents on every run.

In each repository that will host runs, make sure `.gitignore` contains `.orchestration/runs/`.

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

## 6. Confirm

Run `AO doctor` again and report the line `OK — ready to launch.` or the remaining problems.
