#!/usr/bin/env bash
# Test fixture for `claude-sessions clean --quiet` (BDM-29).
#
# Verifies:
#   1. `clean` (no flag) prints one line per stale meta to stdout.
#   2. `clean --quiet` (and `-q`) prints nothing to stdout, exits 0,
#      and still removes the stale meta files.
#   3. `cleanup` is accepted as an alias for `clean`.
#   4. `--help` text mentions the new flag.
#   5. Unknown flag → exit 64 + usage error on stderr.

set -u

DAEMON="$(cd "$(dirname "$0")/.." && pwd)/bin/claude-sessions"
[[ -x "$DAEMON" || -f "$DAEMON" ]] || { echo "FAIL: daemon not at $DAEMON" >&2; exit 1; }

PASS=0
FAIL=0

TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT

export CLAUDE_PLUGIN_DATA="$TMPDIR_TEST/data"
export CLAUDE_PROJECT_DIR="$TMPDIR_TEST/project"
mkdir -p "$CLAUDE_PROJECT_DIR"
cd "$CLAUDE_PROJECT_DIR"
HOME="$TMPDIR_TEST"; export HOME

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

# Seed two stale meta files (no tmux sessions exist for these tickets).
seed_stale() {
  local ticket="$1"
  mkdir -p "$SESSIONS_DIR/$ticket"
  cat >"$SESSIONS_DIR/$ticket/meta" <<EOF
ticket=$ticket
session=fleet-${ticket}-no-such-session-$$
log=$SESSIONS_DIR/$ticket/log
EOF
}

# --- 1. No-op invocation with --quiet must produce zero stdout --------------
echo "=== clean --quiet on no metas → empty stdout, exit 0 ==="
exit_code=0
out="$("$DAEMON" clean --quiet 2>/dev/null)" || exit_code=$?
assert_eq "exit 0"            "0" "$exit_code"
assert_eq "stdout empty"      ""  "$out"

echo
echo "=== clean -q on no metas → empty stdout, exit 0 ==="
exit_code=0
out="$("$DAEMON" clean -q 2>/dev/null)" || exit_code=$?
assert_eq "short -q exit 0"   "0" "$exit_code"
assert_eq "short -q stdout empty" "" "$out"

echo
echo "=== cleanup (alias) --quiet on no metas → empty stdout ==="
exit_code=0
out="$("$DAEMON" cleanup --quiet 2>/dev/null)" || exit_code=$?
assert_eq "alias exit 0"      "0" "$exit_code"
assert_eq "alias stdout empty" "" "$out"

# --- 2. With stale metas: default speaks, --quiet silent --------------------
echo
echo "=== clean (default) prints removal line ==="
seed_stale "TEST-A"
out="$("$DAEMON" clean 2>/dev/null)"
assert_contains "default mentions ticket"     "TEST-A"          "$out"
assert_contains "default uses removal phrase" "removing stale meta" "$out"
[[ -e "$SESSIONS_DIR/TEST-A/meta" ]] && { echo "  FAIL meta still present"; FAIL=$((FAIL+1)); } \
                                     || { echo "  PASS meta removed"; PASS=$((PASS+1)); }

echo
echo "=== clean --quiet still removes meta but emits no stdout ==="
seed_stale "TEST-B"
out="$("$DAEMON" clean --quiet 2>/dev/null)"
assert_eq      "quiet stdout empty"  ""  "$out"
[[ -e "$SESSIONS_DIR/TEST-B/meta" ]] && { echo "  FAIL meta still present"; FAIL=$((FAIL+1)); } \
                                     || { echo "  PASS meta removed under --quiet"; PASS=$((PASS+1)); }

# --- 3. Help text mentions --quiet -----------------------------------------
echo
echo "=== --help mentions --quiet ==="
help_out="$("$DAEMON" --help 2>&1)"
assert_contains "help mentions --quiet" "--quiet" "$help_out"
assert_contains "help mentions cleanup alias" "cleanup" "$help_out"

# --- 4. Unknown flag -------------------------------------------------------
echo
echo "=== unknown flag → exit 64 + stderr ==="
exit_code=0
err="$("$DAEMON" clean --bogus 2>&1 >/dev/null)" || exit_code=$?
assert_eq      "exit 64"         "64" "$exit_code"
assert_contains "error mentions flag" "--bogus" "$err"

echo
echo "=== Result ==="
printf 'Passed: %d  Failed: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
