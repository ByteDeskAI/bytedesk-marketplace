#!/usr/bin/env bash
# Single wrapper for every knowledge-management hook event.
# A hook bug must never brick the session — always exit 0.
set -u

EVENT="${1:-}"
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "$EVENT" ]]; then
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  exit 0
fi

node "$PLUGIN_ROOT/bin/km" hook "$EVENT" 2>/tmp/km-hook-$$.err || true
if [[ -s /tmp/km-hook-$$.err ]]; then
  cat /tmp/km-hook-$$.err >&2
fi
rm -f /tmp/km-hook-$$.err
exit 0
