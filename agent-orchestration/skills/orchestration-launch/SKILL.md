---
name: orchestration-launch
description: Launch a saved orchestration template (or a spec file) as a tmux session with one pane per agent, each CLI started with its role, skills, and mailbox. Use when the user says "launch", "start the tournament", "spin up the team", "run the <name> orchestration", or names a template.
user-invokable: true
argument-hint: "<template-name | spec.json> [--input k=v]... [--consumer <repo>] [--dry-run]"
---

# Launch an orchestration

Resolve `AO` as `../../bin/ao-topology` relative to this skill (the installed plugin copy).

## Process

1. **Check the machine** once per session: `AO doctor --consumer <repo>`. If tmux or a needed CLI
   is missing, stop and hand the user to `setup-agent-orchestration`; do not improvise installs.
2. **Pick the template.** `AO templates --consumer <repo>` lists user, consumer, and plugin
   templates. If the user described a team instead of naming one, run `orchestration-compose`
   first.
3. **Gather inputs.** `AO inputs --template <name>` lists every input with its description,
   default, and — when the template defines `options` — the allowed values with one line each.
   Present option inputs to the user as a menu (AskUserQuestion when available; one question per
   input, multi-select when the input says "pick one or more") and free-text inputs as a short
   question; skip inputs whose default the user is happy with. Pass results as
   `--input name=value` (comma-separated for multi). The CLI rejects a value outside the options,
   so never guess one.
4. **Decide the consumer directory** — the repository the agents work in (`--consumer`). It is
   where `.orchestration/runs/<run_id>/` is created. Make sure `.orchestration/runs/` is
   gitignored there; offer to add it if not.
5. **Dry-run first when anything is new**: `AO launch --template <name> --input ... --consumer <repo> --dry-run`.
   Read the warnings: missing skills, missing role packs, generic-adapter fallbacks. Fix what
   matters (a missing skill for a designer matters; a generic fallback for a CLI the user chose on
   purpose does not).
6. **Launch**: same command without `--dry-run`. Report exactly what it prints: run dir, session
   name, which provider each agent came up on (and what it skipped — a `fell back to` warning
   means a usage limit or missing CLI was handled automatically), warnings, and the attach command.
   An agent on `NO PROVIDER` means its whole chain failed; fix the CLI and run
   `AO failover --run <run_dir> --agent <id> --to <cli:model>`.
7. **Tell the user how to watch and steer**, in two lines: `tmux attach -t <session>` to watch
   every pane (the conductor is the main pane; `Ctrl-b` then arrow keys to move between panes,
   `Ctrl-b d` to detach), and `AO status --run <run_dir>` from any shell for the journal.
   The conductor pane is where human gates are answered.
8. If an agent shows `?` (not ready) in the launch output, `AO capture --run <run_dir> --agent <id>`
   and read its screen: usually a login prompt, a missing flag, or a slow start. Re-send the
   bootstrap with `AO nudge --run <run_dir> --agent <id> --text "Read <bootstrap path> and follow it exactly."`
   once the CLI is at its prompt.

## Do not

- Do not become the conductor yourself. The conductor is the agent in the first pane; this session
  only launches and observes.
- Do not launch twice into the same session name; `AO stop --run <run_dir>` first.
- Do not pass secrets through `--input`; they end up in `run.json`.
