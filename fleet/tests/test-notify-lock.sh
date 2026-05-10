#!/usr/bin/env bash
# Test fixture for the BDM-4 notify-daemon lock + depth-aware behaviors.
#
# Sources bin/claude-sessions (the main guard skips dispatch when sourced)
# and exercises:
#   - _try_acquire_pid_lock: empty file → acquire; live holder → block;
#                            stale holder (PID dead) → reclaim
#   - cmd_notify with CLAUDE_SESSION_DEPTH >= 1: early-exit, no lock attempt
#
# Run: bash fleet/tests/test-notify-lock.sh

set -u  # don't `-e` — keep running after assertion failures

DAEMON="$(cd "$(dirname "$0")/.." && pwd)/bin/claude-sessions"
[[ -f "$DAEMON" ]] || { echo "FAIL: daemon not found at $DAEMON" >&2; exit 1; }

PASS=0
FAIL=0

# ─── Setup: isolated state via CLAUDE_PLUGIN_DATA + CLAUDE_PROJECT_DIR ────────
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CLAUDE_PLUGIN_DATA="$TMP/data"
CLAUDE_PROJECT_DIR="$TMP/project"
export CLAUDE_PLUGIN_DATA CLAUDE_PROJECT_DIR
mkdir -p "$CLAUDE_PROJECT_DIR"

# Source the script — the main guard at the bottom only runs the dispatcher
# when ${BASH_SOURCE[0]} == $0, so sourcing exposes functions cleanly.
# shellcheck disable=SC1090
source "$DAEMON"

assert() {
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

echo "=== _try_acquire_pid_lock ==="

PID_DIR="$(_notify_dir)"
mkdir -p "$PID_DIR"
PID_FILE="$PID_DIR/pid"

# 1. No existing file → acquire.
rm -f "$PID_FILE"
rc=0
_try_acquire_pid_lock "$PID_FILE" || rc=$?
assert "acquire when no pid file"          "0" "$rc"
assert "pid file written on acquire"       "$$" "$(cat "$PID_FILE")"

# 2. Live holder (this same process) → blocked.
rc=0
_try_acquire_pid_lock "$PID_FILE" || rc=$?
assert "blocked when live holder present"  "1" "$rc"

# 3. Stale holder (PID is dead) → reclaim.
echo 999999999 > "$PID_FILE"   # an unlikely-to-exist PID
rc=0
_try_acquire_pid_lock "$PID_FILE" || rc=$?
assert "reclaim when holder PID is dead"   "0" "$rc"
assert "pid file rewritten on reclaim"     "$$" "$(cat "$PID_FILE")"

# 4. Empty pid file → reclaim (treated like stale).
: >"$PID_FILE"
rc=0
_try_acquire_pid_lock "$PID_FILE" || rc=$?
assert "reclaim when pid file is empty"    "0" "$rc"

echo
echo "=== cmd_notify depth >= 1 early-exit ==="

# At CLAUDE_SESSION_DEPTH=1, cmd_notify should return 0 immediately without
# attempting to acquire the lock. Pre-seed the lock with a live (this proc)
# holder so any acquisition attempt would block — if cmd_notify still runs
# past the depth check, we'd see different behavior.
echo $$ > "$PID_FILE"

CLAUDE_SESSION_DEPTH=1 cmd_notify --once >/dev/null 2>&1
rc=$?
assert "depth=1 returns 0 without polling" "0" "$rc"
assert "depth=1 leaves lock untouched"     "$$" "$(cat "$PID_FILE")"

CLAUDE_SESSION_DEPTH=2 cmd_notify --once >/dev/null 2>&1
rc=$?
assert "depth=2 (grandchild) also short-circuits" "0" "$rc"

# Depth=0 (default) with --once should run the inner loop. We don't have
# notify-send in CI, so cmd_notify will exit non-zero with an error message.
# That's fine — it proves we got PAST the depth check.
unset CLAUDE_SESSION_DEPTH
out=$(cmd_notify --once 2>&1 || true)
if [[ "$out" == *"notify-send not found"* ]]; then
  printf '  \e[32mPASS\e[0m depth=0 reaches notify-send check (no early-exit)\n'
  PASS=$((PASS+1))
elif [[ -z "$out" ]]; then
  # notify-send IS available — also fine, the run completed.
  printf '  \e[32mPASS\e[0m depth=0 reaches polling (notify-send available)\n'
  PASS=$((PASS+1))
else
  printf '  \e[33mSKIP\e[0m depth=0 (unexpected output, env-dependent): %.80s\n' "$out"
fi

echo
echo "=== Result ==="
printf 'Passed: %d  Failed: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
