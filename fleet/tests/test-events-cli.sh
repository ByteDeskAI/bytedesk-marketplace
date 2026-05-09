#!/usr/bin/env bash
# Test fixture for `claude-sessions events <TICKET>` (BDP-375).
#
# Run: bash scripts/claude-sessions/tests/test-events-cli.sh

set -u

DAEMON="$(cd "$(dirname "$0")/.." && pwd)/bin/claude-sessions"
[[ -f "$DAEMON" ]] || { echo "FAIL: daemon not found at $DAEMON" >&2; exit 1; }

PASS=0
FAIL=0

# --- Setup ------------------------------------------------------------------
TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT

HOME="$TMPDIR_TEST"
export HOME

SESSIONS_DIR="$HOME/.claude-sessions"
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

assert_lines() {
  local name="$1" expected="$2" actual_text="$3"
  local actual_lines
  actual_lines="$(echo -n "$actual_text" | grep -c '^' 2>/dev/null || echo 0)"
  [[ -z "$actual_text" ]] && actual_lines=0
  if [[ "$actual_lines" == "$expected" ]]; then
    printf '  \e[32mPASS\e[0m %s (%d lines)\n' "$name" "$actual_lines"
    PASS=$((PASS+1))
  else
    printf '  \e[31mFAIL\e[0m %s (expected %s lines, got %d)\n    output:\n%s\n' \
      "$name" "$expected" "$actual_lines" "$actual_text"
    FAIL=$((FAIL+1))
  fi
}

# --- Seed events ------------------------------------------------------------
TICKET="TEST-9"
EVENTS_FILE="$SESSIONS_DIR/${TICKET}.events"

cat >"$EVENTS_FILE" <<'EOF'
{"ts":"2026-05-09T16:42:01Z","ticket":"TEST-9","depth":1,"kind":"review_comment","detail":{"pr":"346"}}
{"ts":"2026-05-09T16:42:35Z","ticket":"TEST-9","depth":1,"kind":"review_summary","detail":{"pr":"346","verdict":"approve"}}
{"ts":"2026-05-09T16:43:10Z","ticket":"TEST-9","depth":1,"kind":"merge","detail":{"pr":"346"}}
{"ts":"2026-05-09T16:43:55Z","ticket":"TEST-9","depth":1,"kind":"commit_pushed","detail":{"branch":"feature/x"}}
EOF

# --- Tests -----------------------------------------------------------------

echo "=== Default plain output — all events ==="
out="$(HOME=$HOME "$DAEMON" events "$TICKET" 2>&1)"
assert_lines    "4 events emitted"  "4"  "$out"
assert_contains "first line shows hms" "16:42:01" "$out"
assert_contains "review_comment kind"  "review_comment" "$out"
assert_contains "merge with pr=346"    "merge  pr=346" "$out"
assert_contains "commit_pushed body"   "branch=feature/x" "$out"

echo
echo "=== --json emits raw JSONL ==="
out="$(HOME=$HOME "$DAEMON" events "$TICKET" --json)"
assert_lines     "4 json lines"  "4"  "$out"
# First line should be valid JSON with the right kind
first_kind="$(echo "$out" | head -n1 | jq -r .kind)"
assert_eq "first json kind" "review_comment" "$first_kind"

echo
echo "=== --kinds filter ==="
out="$(HOME=$HOME "$DAEMON" events "$TICKET" --kinds=merge)"
assert_lines    "kinds=merge → 1 line"  "1"  "$out"
assert_contains "filter result is merge" "merge" "$out"

out="$(HOME=$HOME "$DAEMON" events "$TICKET" --kinds=review_summary,merge)"
assert_lines    "kinds=review_summary,merge → 2 lines" "2" "$out"

out="$(HOME=$HOME "$DAEMON" events "$TICKET" --kinds=nonexistent)"
assert_lines    "kinds=nonexistent → 0 lines" "0" "$out"

echo
echo "=== --since filter ==="
out="$(HOME=$HOME "$DAEMON" events "$TICKET" --since=2026-05-09T16:43:00Z)"
assert_lines    "since cutoff → 2 lines (merge + commit_pushed)" "2" "$out"

out="$(HOME=$HOME "$DAEMON" events "$TICKET" --since=2099-01-01T00:00:00Z)"
assert_lines    "since future → 0 lines" "0" "$out"

echo
echo "=== --since combined with --kinds ==="
out="$(HOME=$HOME "$DAEMON" events "$TICKET" --since=2026-05-09T16:43:00Z --kinds=merge --json)"
assert_lines     "combined filter → 1 line"  "1"  "$out"
verdict_field="$(echo "$out" | jq -r .detail.pr)"
assert_eq "filtered event has pr=346" "346" "$verdict_field"

echo
echo "=== Missing events file (session never emitted) → exit 0, empty output ==="
exit_code=0
out="$(HOME=$HOME "$DAEMON" events DOES-NOT-EXIST 2>&1)" || exit_code=$?
assert_eq    "exit 0"          "0"  "$exit_code"
assert_eq    "empty output"    ""   "$out"

echo
echo "=== Missing <ticket> arg → usage error ==="
exit_code=0
err_out="$(HOME=$HOME "$DAEMON" events 2>&1)" || exit_code=$?
assert_eq      "exit 64"            "64"           "$exit_code"
assert_contains "usage shown"        "missing <ticket>" "$err_out"

echo
echo "=== Help text mentions events subcommand ==="
help_out="$(HOME=$HOME "$DAEMON" help 2>&1)"
assert_contains "help mentions events" "events <ticket>" "$help_out"

echo
echo "=== Result ==="
printf 'Passed: %d  Failed: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
