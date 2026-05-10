#!/usr/bin/env bash
# Test fixture for `claude-sessions clean --quiet` (BDM-29).
#
# Variant v2 strategy: cmd_clean redirects fd 1 to /dev/null when --quiet is
# set. This test verifies the visible contract — stdout suppressed under
# --quiet/-q, byte-for-byte preserved without it, and --help still lists the
# subcommand and the flag.
#
# Run: bash fleet/tests/test-clean-quiet.sh

set -u

DAEMON="$(cd "$(dirname "$0")/.." && pwd)/bin/claude-sessions"
[[ -f "$DAEMON" ]] || { echo "FAIL: daemon not found at $DAEMON" >&2; exit 1; }

PASS=0
FAIL=0

# --- Setup: isolated tmpdir-as-CLAUDE_PLUGIN_DATA ----------------------------
TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT

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
    printf '  \e[31mFAIL\e[0m %s\n    expected: %q\n    actual:   %q\n' \
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

# --- 1. No-op invocation: no sessions to prune ------------------------------
echo "=== No-op: empty SESSIONS_DIR ==="

out="$("$DAEMON" clean --quiet 2>/dev/null)"
exit_code=$?
assert_eq    "exit 0 with --quiet"               "0"   "$exit_code"
assert_eq    "no stdout from clean --quiet"      ""    "$out"

out="$("$DAEMON" clean -q 2>/dev/null)"
exit_code=$?
assert_eq    "exit 0 with -q"                    "0"   "$exit_code"
assert_eq    "no stdout from clean -q"           ""    "$out"

out="$("$DAEMON" clean 2>/dev/null)"
exit_code=$?
assert_eq    "exit 0 without flag (no-op)"       "0"   "$exit_code"
assert_eq    "no stdout when nothing to prune"   ""    "$out"

# --- 2. Real prune: seed a stale meta and run with/without --quiet ----------
echo
echo "=== Stale meta is pruned, output gated by --quiet ==="

seed_stale() {
  local ticket="$1"
  mkdir -p "$SESSIONS_DIR/$ticket"
  cat >"$SESSIONS_DIR/$ticket/meta" <<EOF
ticket=$ticket
session=$ticket
log=$SESSIONS_DIR/$ticket/log
EOF
}

# Default (no flag): one stale ticket → one "removing stale meta" line.
seed_stale "BDM-FAKE-LOUD"
out="$("$DAEMON" clean 2>/dev/null)"
exit_code=$?
assert_eq        "exit 0 (loud, stale present)"     "0"  "$exit_code"
assert_contains  "loud output mentions ticket"      "BDM-FAKE-LOUD" "$out"
assert_contains  "loud output uses existing prefix" "removing stale meta" "$out"
[[ -f "$SESSIONS_DIR/BDM-FAKE-LOUD/meta" ]] && {
  printf '  \e[31mFAIL\e[0m loud run did not remove stale meta\n'; FAIL=$((FAIL+1)); } || {
  printf '  \e[32mPASS\e[0m loud run removed stale meta\n'; PASS=$((PASS+1)); }

# --quiet: stale ticket pruned but no stdout.
seed_stale "BDM-FAKE-QUIET"
out="$("$DAEMON" clean --quiet 2>/dev/null)"
exit_code=$?
assert_eq    "exit 0 (quiet, stale present)"      "0"   "$exit_code"
assert_eq    "no stdout from --quiet prune"       ""    "$out"
[[ -f "$SESSIONS_DIR/BDM-FAKE-QUIET/meta" ]] && {
  printf '  \e[31mFAIL\e[0m --quiet run did not remove stale meta\n'; FAIL=$((FAIL+1)); } || {
  printf '  \e[32mPASS\e[0m --quiet run removed stale meta\n'; PASS=$((PASS+1)); }

# --- 3. --help still lists clean and the new flag ---------------------------
echo
echo "=== Help text updated ==="
help_out="$("$DAEMON" --help 2>&1)"
assert_contains "help mentions clean"         "clean"         "$help_out"
assert_contains "help mentions --quiet flag"  "--quiet"       "$help_out"

# --- 4. Unknown flag rejected -----------------------------------------------
echo
echo "=== Unknown flag rejected ==="
err_out="$("$DAEMON" clean --bogus 2>&1 1>/dev/null)"
exit_code=0
"$DAEMON" clean --bogus >/dev/null 2>&1 || exit_code=$?
assert_eq       "exit 64 on unknown flag"   "64"  "$exit_code"
assert_contains "stderr names the flag"     "--bogus"  "$err_out"

echo
echo "=== Result ==="
printf 'Passed: %d  Failed: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
