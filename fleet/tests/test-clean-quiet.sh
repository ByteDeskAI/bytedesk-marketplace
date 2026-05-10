#!/usr/bin/env bash
# Test fixture for `claude-sessions clean --quiet` (BDM-29).

set -u

DAEMON="$(cd "$(dirname "$0")/.." && pwd)/bin/claude-sessions"
[[ -f "$DAEMON" ]] || { echo "FAIL: daemon not found at $DAEMON" >&2; exit 1; }

PASS=0
FAIL=0

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

# --- Seed a stale meta so cmd_clean has something to prune --------------------
TICKET="STALE-1"
mkdir -p "$SESSIONS_DIR/$TICKET"
cat >"$SESSIONS_DIR/$TICKET/meta" <<EOF
session=this-tmux-session-does-not-exist-$$
log=/dev/null
EOF

# --- Tests -------------------------------------------------------------------

echo "=== clean (no flag) prints removal line for stale meta ==="
out="$("$DAEMON" clean 2>/dev/null)"
exit_code=$?
assert_eq "exit 0"                      "0"                                                  "$exit_code"
assert_eq "removal line printed"        "removing stale meta: $TICKET (session this-tmux-session-does-not-exist-$$ is dead)" "$out"

# Re-seed the meta (the previous run removed it).
cat >"$SESSIONS_DIR/$TICKET/meta" <<EOF
session=this-tmux-session-does-not-exist-$$
log=/dev/null
EOF

echo
echo "=== clean --quiet produces no stdout (stale meta still pruned) ==="
out="$("$DAEMON" clean --quiet 2>/dev/null)"
exit_code=$?
assert_eq "exit 0"                "0"  "$exit_code"
assert_eq "no stdout"             ""   "$out"
[[ ! -f "$SESSIONS_DIR/$TICKET/meta" ]] \
  && { printf '  \e[32mPASS\e[0m stale meta still pruned\n'; PASS=$((PASS+1)); } \
  || { printf '  \e[31mFAIL\e[0m stale meta NOT pruned\n'; FAIL=$((FAIL+1)); }

echo
echo "=== clean -q (short form) produces no stdout on no-op invocation ==="
# No sessions left → cmd_clean is a no-op regardless of flag.
out="$("$DAEMON" clean -q 2>/dev/null)"
exit_code=$?
assert_eq "exit 0"   "0"  "$exit_code"
assert_eq "no stdout (no-op)" "" "$out"

echo
echo "=== help still mentions clean ==="
help_out="$("$DAEMON" help 2>&1)"
[[ "$help_out" == *"clean"* ]] \
  && { printf '  \e[32mPASS\e[0m help mentions clean\n'; PASS=$((PASS+1)); } \
  || { printf '  \e[31mFAIL\e[0m help missing clean\n'; FAIL=$((FAIL+1)); }
[[ "$help_out" == *"--quiet"* ]] \
  && { printf '  \e[32mPASS\e[0m help mentions --quiet\n'; PASS=$((PASS+1)); } \
  || { printf '  \e[31mFAIL\e[0m help missing --quiet\n'; FAIL=$((FAIL+1)); }

echo
echo "=== Result ==="
printf 'Passed: %d  Failed: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
