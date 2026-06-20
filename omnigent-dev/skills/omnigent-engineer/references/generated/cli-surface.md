# Omnigent CLI Surface

Generated from live `omnigent --help` output when available.

## Commands
- `omnigent attach`
- `omnigent claude`
- `omnigent codex`
- `omnigent config`
- `omnigent debby`
- `omnigent debug`
- `omnigent host`
- `omnigent login`
- `omnigent pi`
- `omnigent polly`
- `omnigent resume`
- `omnigent run`
- `omnigent sandbox`
- `omnigent server`
- `omnigent setup`
- `omnigent stop`
- `omnigent upgrade`

## Command Details
- Run `uv run omnigent <command> --help` for live subcommand-specific options.
- The refresh script intentionally avoids probing every subcommand so `--check` stays fast enough for routine workflow use.

## Repo Workflow Commands
- `status`
- `landed [<branch>] [--json]`
- `ensure-develop-remote`
- `prepare-web`
- `verify [--dry-run|--json]`
- `graph status [--json]`
- `graph path "A" "B"`
- `graph explain "X"`
- `graph diagnose [--json]`
- `cleanup [<name>] [--force]`
- `reap-merged [--dry-run]`
- `cap-vms`
- `doctor`
- `diagnose`
