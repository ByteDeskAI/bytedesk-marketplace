#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KM="$ROOT/bin/km"
HOOK="$ROOT/hooks/km-hook.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export KM_ROOT="$TMP"
export KM_NO_AUTOLINK=1

node "$KM" init
node "$KM" concept new "Hook Topic" --type Reference --desc "for hooks"

echo "== session-start via CLI hook =="
OUT=$(echo '{}' | node "$KM" hook session-start)
echo "$OUT" | grep -qi 'progressive\|concepts\|Hook Topic\|knowledge-management'

echo "== shell wrapper always 0 =="
echo '{}' | bash "$HOOK" session-start
echo '{}' | bash "$HOOK" pre-compact
echo '{}' | bash "$HOOK" stop

# wrapper with empty event
bash "$HOOK" || true

echo "test-hooks.sh OK"
