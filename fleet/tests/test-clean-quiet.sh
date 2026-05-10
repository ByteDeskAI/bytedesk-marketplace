#!/usr/bin/env bash
# Test fixture for `claude-sessions clean --quiet` (BDM-29).
#
# Confirms:
#   1. `clean --quiet` produces no stdout on a no-op invocation.
#   2. `clean -q` (short form) behaves identically.
#   3. `clean` (no flag) still produces the expected per-step output.
#   4. An unknown flag exits non-zero with a clean: error on stderr.
#
# Self-isolated via mktemp + HOME override, matching the pattern used by
# fleet/tests/test-event-dispatch.sh.
#
# Run: bash fleet/tests/test-clean-quiet.sh

set -u

BIN="$(cd "$(dirname "$0")/.." && pwd)/bin/claude-sessions"
[[ -x "$BIN" ]] || { echo "FAIL: claude-sessions not executable at $BIN" >&2; exit 1; }

PASS=0
FAIL=0

TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT

export CLAUDE_PLUGIN_DATA="$TMPDIR_TEST/data"
export CLAUDE_PROJECT_DIR="$TMPDIR_TEST/project"
mkdir -p "$CLAUDE_PROJECT_DIR"
HOME="$TMPDIR_TEST"
export HOME

run_clean() {
  ( cd "$CLAUDE_PROJECT_DIR" && "$BIN" clean "$@" )
}

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    printf '  \e[32mPASS\e[0m %s\n' "$name"
    PASS=$((PASS+1))
  else
    printf '  \e[31mFAIL\e[0m %s\n    expected: %q\n    actual:   %q\n' \
      "$name" "$expected" "$actual"
    FAIL=$((FAIL+1))
  fi
}

echo "=== clean --quiet on no-op invocation produces no stdout ==="
out_long="$(run_clean --quiet 2>/dev/null)"
rc_long=$?
assert_eq "stdout empty (--quiet)" "" "$out_long"
assert_eq "exit code 0 (--quiet)"  "0" "$rc_long"

echo
echo "=== clean -q (short form) produces no stdout ==="
out_short="$(run_clean -q 2>/dev/null)"
rc_short=$?
assert_eq "stdout empty (-q)" "" "$out_short"
assert_eq "exit code 0 (-q)"  "0" "$rc_short"

echo
echo "=== clean with stale meta + --quiet still removes meta and is silent ==="
TICKET_DIR="$CLAUDE_PLUGIN_DATA/projects/$(cd "$CLAUDE_PROJECT_DIR" && \
  realpath . | sha256sum | cut -d' ' -f1 | head -c 12)/sessions/BDM-29-fixture"
mkdir -p "$TICKET_DIR"
cat >"$TICKET_DIR/meta" <<EOF
session=does-not-exist-$$
log=$TICKET_DIR/log
branch=feature/fixture
EOF
out_stale_quiet="$(run_clean --quiet 2>/dev/null)"
assert_eq "stdout empty when stale meta exists (--quiet)" "" "$out_stale_quiet"
[[ -f "$TICKET_DIR/meta" ]] && {
  printf '  \e[31mFAIL\e[0m stale meta should have been removed\n'
  FAIL=$((FAIL+1))
} || {
  printf '  \e[32mPASS\e[0m stale meta removed under --quiet\n'
  PASS=$((PASS+1))
}

echo
echo "=== clean without flag still emits per-step output ==="
mkdir -p "$TICKET_DIR"
cat >"$TICKET_DIR/meta" <<EOF
session=does-not-exist-$$
log=$TICKET_DIR/log
branch=feature/fixture
EOF
out_loud="$(run_clean 2>/dev/null)"
case "$out_loud" in
  *"removing stale meta: BDM-29-fixture"*)
    printf '  \e[32mPASS\e[0m verbose mode preserved\n'
    PASS=$((PASS+1)) ;;
  *)
    printf '  \e[31mFAIL\e[0m expected per-step output, got: %q\n' "$out_loud"
    FAIL=$((FAIL+1)) ;;
esac

echo
echo "=== unknown flag → exit 64 with stderr message ==="
err="$(run_clean --bogus 2>&1 >/dev/null)"
rc_bogus=$?
assert_eq "exit 64 on unknown flag" "64" "$rc_bogus"
case "$err" in
  *"clean: unknown flag --bogus"*)
    printf '  \e[32mPASS\e[0m stderr names the unknown flag\n'
    PASS=$((PASS+1)) ;;
  *)
    printf '  \e[31mFAIL\e[0m unexpected stderr: %q\n' "$err"
    FAIL=$((FAIL+1)) ;;
esac

echo
echo "=== Result ==="
printf 'Passed: %d  Failed: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
