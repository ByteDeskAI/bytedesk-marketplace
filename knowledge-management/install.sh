#!/usr/bin/env bash
# Put `km` on PATH. Idempotent. Mirrors task-management/install.sh.
#
# Zero-install: YAML is vendored under lib/vendor/yaml — no npm ci required
# for the CLI, hooks, or MCP after /plugin install.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

if [[ "${1:-}" == "--uninstall" ]]; then
  node "$ROOT/bin/km" uninstall
  exit 0
fi

node "$ROOT/bin/km" install "$@"
node "$ROOT/bin/km" where | head -20
