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

# Every nats-server a test starts keeps its store under this per-run dir, so the leak check below
# matches only this run's servers and never another session's.
export TM_TEST_TMP="$(mktemp -d /tmp/tm-run-XXXXXX)"

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

# Leak check: a server still alive with a store under this run's dir is a test that did not tear down.
LEAKED="$(pgrep -a -x nats-server | grep -F "$TM_TEST_TMP" || true)"
if [[ -n "$LEAKED" ]]; then
  echo "LEAK: nats-server left running by this run:"; echo "$LEAKED" | sed 's/^/    /'
  pgrep -a -x nats-server | grep -F "$TM_TEST_TMP" | cut -d' ' -f1 | xargs -r kill -9
  FAILED+=("nats-server-leak")
fi
rm -rf "$TM_TEST_TMP"

echo
if (( ${#FAILED[@]} )); then
  echo "FAILED: ${FAILED[*]}"
  exit 1
fi
echo "all green"
