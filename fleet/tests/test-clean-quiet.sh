#!/usr/bin/env bash
# Test fixture for `claude-sessions clean --quiet` (BDM-29).
#
# Run: bash fleet/tests/test-clean-quiet.sh

set -u

DAEMON="$(cd "$(dirname "$0")/.." && pwd)/bin/claude-sessions"
[[ -f "$DAEMON" ]] || { echo "FAIL: daemon not found at $DAEMON" >&2; exit 1; }

PASS=0
FAIL=0

# --- Setup ------------------------------------------------------------------
TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT

# Pin plugin data root + project dir, then cd into the project dir so the
# daemon (subprocess) computes a deterministic per-project sessions path.
export CLAUDE_PLUGIN_DATA="$TMPDIR_TEST/data"
export CLAUDE_PROJECT_DIR="$TMPDIR_TEST/project"
mkdir -p "$CLAUDE_PROJECT_DIR"
cd "$CLAUDE_PROJECT_DIR"
HOME="$TMPDIR_TEST"
export HOME

PROJECT_KEY="$(realpath "$CLAUDE_PROJECT_DIR" | sha256sum | cut -d' ' -f1 | head -c 12)"
SESSIONS_DIR="$CLAUDE_PLUGIN_DATA/projects/$PROJECT_KEY/sessions"
mkdir -p "$SESSIONS_DIR"

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    printf '  \e[32mPASS\e[0m %s\n' "$name"
    PASS=$((PASS+1))
  else
    printf '  \e[31mFAIL\e[0m %s\n    expected: %s\n    actual:   %s\n' \
      "$name" "$expected" "$actual"
    FAIL=$((FAIL+1))
  fi
}

assert_contains() {
  local name="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    printf '  \e[32mPASS\e[0m %s\n' "$name"
    PASS=$((PASS+1))
  else
    printf '  \e[31mFAIL\e[0m %s\n    needle:    %s\n    haystack:  %s\n' \
      "$name" "$needle" "$haystack"
    FAIL=$((FAIL+1))
  fi
}

# --- Tests -----------------------------------------------------------------

echo "=== clean --quiet on no-op invocation produces no stdout ==="
exit_code=0
out="$(HOME=$HOME "$DAEMON" clean --quiet 2>/dev/null)" || exit_code=$?
assert_eq "exit 0"             "0"  "$exit_code"
assert_eq "stdout is empty"    ""   "$out"

echo
echo "=== clean -q (short flag) on no-op invocation produces no stdout ==="
exit_code=0
out="$(HOME=$HOME "$DAEMON" clean -q 2>/dev/null)" || exit_code=$?
assert_eq "exit 0"             "0"  "$exit_code"
assert_eq "stdout is empty"    ""   "$out"

echo
echo "=== clean (no flag) on no-op invocation also produces no stdout ==="
# With no stale meta files at all, even non-quiet cleanup has nothing to say.
exit_code=0
out="$(HOME=$HOME "$DAEMON" clean 2>/dev/null)" || exit_code=$?
assert_eq "exit 0"             "0"  "$exit_code"
assert_eq "stdout is empty"    ""   "$out"

echo
echo "=== clean (no flag) emits per-session line for stale meta ==="
TICKET="STALE-1"
mkdir -p "$SESSIONS_DIR/$TICKET"
# Reference a tmux session that does not exist so cmd_clean treats it as stale.
cat >"$SESSIONS_DIR/$TICKET/meta" <<EOF
ticket=$TICKET
session=fleet-bdm29-nonexistent-$$
branch=feature/$TICKET
log=$SESSIONS_DIR/$TICKET/log
EOF

out="$(HOME=$HOME "$DAEMON" clean 2>/dev/null)"
assert_contains "non-quiet announces removal" "removing stale meta: $TICKET" "$out"
[[ ! -e "$SESSIONS_DIR/$TICKET/meta" ]] && {
  printf '  \e[32mPASS\e[0m stale meta file was removed\n'
  PASS=$((PASS+1))
} || {
  printf '  \e[31mFAIL\e[0m stale meta file was NOT removed\n'
  FAIL=$((FAIL+1))
}

echo
echo "=== clean --quiet still removes stale meta but stays silent ==="
TICKET="STALE-2"
mkdir -p "$SESSIONS_DIR/$TICKET"
cat >"$SESSIONS_DIR/$TICKET/meta" <<EOF
ticket=$TICKET
session=fleet-bdm29-nonexistent-$$-2
branch=feature/$TICKET
log=$SESSIONS_DIR/$TICKET/log
EOF

out="$(HOME=$HOME "$DAEMON" clean --quiet 2>/dev/null)"
assert_eq "stdout is empty even with stale meta" "" "$out"
[[ ! -e "$SESSIONS_DIR/$TICKET/meta" ]] && {
  printf '  \e[32mPASS\e[0m stale meta file was removed under --quiet\n'
  PASS=$((PASS+1))
} || {
  printf '  \e[31mFAIL\e[0m stale meta file was NOT removed under --quiet\n'
  FAIL=$((FAIL+1))
}

echo
echo "=== unknown flag → exit 64 with stderr message ==="
exit_code=0
err_out="$(HOME=$HOME "$DAEMON" clean --bogus 2>&1 >/dev/null)" || exit_code=$?
assert_eq      "exit 64"           "64"                    "$exit_code"
assert_contains "stderr explains"  "unknown flag --bogus"  "$err_out"

echo
echo "=== Help text mentions the new flag ==="
help_out="$(HOME=$HOME "$DAEMON" help 2>&1)"
assert_contains "help mentions clean --quiet" "clean [--quiet|-q]" "$help_out"

echo
echo "=== Result ==="
printf 'Passed: %d  Failed: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
