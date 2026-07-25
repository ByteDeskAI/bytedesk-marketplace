#!/usr/bin/env bash
# Single wrapper for every task-management hook event. All logic lives in
# `tm hook <event>` (lib/enforce.mjs); this file only guarantees the contract:
# a hook bug must never brick the session, so we always exit 0.
#
# Gate decisions still reach Claude because they are JSON on stdout — a denied
# TaskCreate or a blocked Stop is data, not an exit code.
set -u

EVENT="${1:-}"
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "$EVENT" ]]; then
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  exit 0
fi

# stdin is the hook payload; pass it straight through.
node "$PLUGIN_ROOT/bin/tm" hook "$EVENT" 2>/tmp/tm-hook-$$.err || true
if [[ -s /tmp/tm-hook-$$.err ]]; then
  cat /tmp/tm-hook-$$.err >&2
fi
rm -f /tmp/tm-hook-$$.err
exit 0
