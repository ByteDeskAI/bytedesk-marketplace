#!/usr/bin/env bash
# Out-of-band install: put `tm` and `tm-dashboard` on PATH. Idempotent.
#
# You usually do not need this — the SessionStart hook links them automatically
# the first time the plugin runs, unless TM_NO_AUTOLINK=1 / TM_AUTOLINK=0 or
# something else already owns the name. This is the manual path. Mirrors fleet/install.sh.
#
#   ./install.sh              link into ${TM_BIN_DIR:-~/.local/bin}
#   ./install.sh --force      take the name even if something else has it
#   ./install.sh --uninstall  remove our symlinks (ours only)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

if [[ "${1:-}" == "--uninstall" ]]; then
  node "$ROOT/bin/tm" uninstall
  exit 0
fi

node "$ROOT/bin/tm" install "$@"
node "$ROOT/bin/tm" where | head -20
