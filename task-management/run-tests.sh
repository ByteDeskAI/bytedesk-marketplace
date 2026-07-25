#!/usr/bin/env bash
# Every test in the plugin: node:test units for lib/, bash suites for the hook and
# CLI contracts. Exits non-zero if anything fails.
#
#   ./run-tests.sh            everything
#   ./run-tests.sh unit       just the node:test units
#   ./run-tests.sh contract   just the bash suites
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
WHICH="${1:-all}"
FAILED=()

if [[ "$WHICH" == "all" || "$WHICH" == "unit" ]]; then
  echo "── unit (node:test) ──────────────────────────────────────────"
  if compgen -G "$ROOT/tests/unit/*.test.mjs" > /dev/null; then
    if node --test "$ROOT"/tests/unit/*.test.mjs; then :; else FAILED+=("node:test"); fi
  else
    echo "(no unit tests yet)"
  fi
fi

if [[ "$WHICH" == "all" || "$WHICH" == "contract" ]]; then
  echo
  echo "── contract (bash) ───────────────────────────────────────────"
  for f in "$ROOT"/tests/*.sh; do
    [[ -e "$f" ]] || continue
    printf '%-22s' "$(basename "$f")"
    if out="$(bash "$f" 2>&1)"; then
      echo "${out##*$'\n'}"
    else
      echo "FAILED"
      echo "$out" | sed 's/^/    /'
      FAILED+=("$(basename "$f")")
    fi
  done
fi

echo
if (( ${#FAILED[@]} )); then
  echo "FAILED: ${FAILED[*]}"
  exit 1
fi
echo "all green"
