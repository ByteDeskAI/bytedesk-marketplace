#!/usr/bin/env bash
# Test fixture for claude-sessions daemon event-tailing + sink dispatch
# (BDP-374). Sources the daemon script (the main guard skips dispatch when
# sourced) and exercises the helper functions in isolation against a
# tmpdir-isolated SESSIONS_DIR.
#
# Run: bash scripts/claude-sessions/tests/test-event-dispatch.sh

set -u

DAEMON="$(cd "$(dirname "$0")/.." && pwd)/bin/claude-sessions"
[[ -f "$DAEMON" ]] || { echo "FAIL: daemon not found at $DAEMON" >&2; exit 1; }

PASS=0
FAIL=0

# --- Setup: isolated tmpdir-as-SESSIONS_DIR ----------------------------------
TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT

# Override HOME so $SESSIONS_DIR computes to our tmpdir
HOME="$TMPDIR_TEST"
export HOME

# Source the daemon — main guard skips dispatch
# shellcheck disable=SC1090
source "$DAEMON"

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
    printf '  \e[31mFAIL\e[0m %s\n    needle:   %s\n    haystack: %s\n' \
      "$name" "$needle" "$haystack"
    FAIL=$((FAIL+1))
  fi
}

# --- Tests ------------------------------------------------------------------

echo "=== ensure_notify_config — generates default if missing ==="
[[ -f "$NOTIFY_CONFIG" ]] && rm "$NOTIFY_CONFIG"
ensure_notify_config
[[ -f "$NOTIFY_CONFIG" ]] && {
  printf '  \e[32mPASS\e[0m default config created\n'
  PASS=$((PASS+1))
} || {
  printf '  \e[31mFAIL\e[0m default config not created\n'
  FAIL=$((FAIL+1))
}

echo
echo "=== notify_sinks_for — parses TOML kind→sinks mapping ==="
sinks_review_summary="$(notify_sinks_for review_summary | tr '\n' ',' | sed 's/,$//')"
assert_eq "review_summary → desktop"        "desktop"          "$sinks_review_summary"

sinks_merge="$(notify_sinks_for merge | tr '\n' ',' | sed 's/,$//')"
assert_eq "merge → desktop,bell"            "desktop,bell"     "$sinks_merge"

sinks_review_comment="$(notify_sinks_for review_comment | tr '\n' ',' | sed 's/,$//')"
assert_eq "review_comment → empty (default)" ""                "$sinks_review_comment"

sinks_unknown="$(notify_sinks_for unknown_kind | tr '\n' ',' | sed 's/,$//')"
assert_eq "unknown kind → empty"             ""                "$sinks_unknown"

echo
echo "=== Custom config overrides default ==="
cat >"$NOTIFY_CONFIG" <<'EOF'
[events]
merge = ["fifo"]
review_summary = ["fifo", "bell"]
EOF

sinks_merge_override="$(notify_sinks_for merge | tr '\n' ',' | sed 's/,$//')"
assert_eq "custom merge → fifo only"         "fifo"             "$sinks_merge_override"

sinks_review_summary_override="$(notify_sinks_for review_summary | tr '\n' ',' | sed 's/,$//')"
assert_eq "custom review_summary → fifo,bell" "fifo,bell"       "$sinks_review_summary_override"

echo
echo "=== tail_session_events — first encounter writes offset, no replay ==="
TICKET="TEST-1"
EVENTS_FILE="$SESSIONS_DIR/${TICKET}.events"
OFFSET_FILE="$SESSIONS_DIR/${TICKET}.events.offset"

# Pre-write some "historical" events
cat >"$EVENTS_FILE" <<EOF
{"ts":"2026-05-09T10:00:00Z","ticket":"$TICKET","depth":0,"kind":"merge","detail":{"pr":"100"}}
{"ts":"2026-05-09T10:01:00Z","ticket":"$TICKET","depth":0,"kind":"merge","detail":{"pr":"200"}}
EOF

# Configure fifo sink only so we can inspect output (and it's a no-op when
# no reader is attached — but it doesn't need to fire here since this is
# the first-encounter case).
cat >"$NOTIFY_CONFIG" <<'EOF'
[events]
merge = ["fifo"]
EOF

# First call: should set offset to file size, no events processed
tail_session_events "$TICKET"
[[ -f "$OFFSET_FILE" ]] && offset="$(cat "$OFFSET_FILE")" || offset=""
size="$(stat -c%s "$EVENTS_FILE")"
assert_eq "offset set to current size on first encounter" "$size" "$offset"

echo
echo "=== tail_session_events — subsequent encounter dispatches new lines only ==="
# Append a new event AFTER the offset
cat >>"$EVENTS_FILE" <<EOF
{"ts":"2026-05-09T10:02:00Z","ticket":"$TICKET","depth":0,"kind":"merge","detail":{"pr":"346"}}
EOF

# Make sink_fifo append to a test file instead of fifo (override function)
DISPATCHED=()
sink_fifo() {
  DISPATCHED+=("$1")
}

tail_session_events "$TICKET"

# Should have dispatched 1 new event
assert_eq "dispatched count = 1" "1" "${#DISPATCHED[@]}"
assert_contains "dispatched event has pr=346" "346" "${DISPATCHED[0]:-}"
assert_contains "dispatched event kind=merge" '"kind":"merge"' "${DISPATCHED[0]:-}"

# Offset should now equal full file size
new_size="$(stat -c%s "$EVENTS_FILE")"
new_offset="$(cat "$OFFSET_FILE")"
assert_eq "offset advanced to new file size" "$new_size" "$new_offset"

echo
echo "=== tail_session_events — no new events between calls ==="
DISPATCHED=()
tail_session_events "$TICKET"
assert_eq "no dispatch when nothing new" "0" "${#DISPATCHED[@]}"

echo
echo "=== tail_session_events — file truncation handled (cur < prev) ==="
DISPATCHED=()
echo "" > "$EVENTS_FILE"   # truncate
tail_session_events "$TICKET"
# Should not error; should not dispatch anything; offset can be anywhere reasonable.
assert_eq "truncation: no dispatch" "0" "${#DISPATCHED[@]}"

echo
echo "=== tail_session_events — missing events file is a no-op ==="
DISPATCHED=()
tail_session_events "DOES-NOT-EXIST"
assert_eq "missing file: no dispatch" "0" "${#DISPATCHED[@]}"

echo
echo "=== dispatch_event — routes to multiple configured sinks ==="
cat >"$NOTIFY_CONFIG" <<'EOF'
[events]
merge = ["fifo", "bell"]
EOF

# Override sinks to record calls
FIFO_CALLS=()
BELL_CALLS=()
DESKTOP_CALLS=()
SLACK_CALLS=()
sink_fifo()    { FIFO_CALLS+=("$1"); }
sink_bell()    { BELL_CALLS+=("$1|$2"); }
sink_desktop() { DESKTOP_CALLS+=("$1|$2|$3"); }
sink_slack()   { SLACK_CALLS+=("$1|$2"); }

EVENT='{"ts":"2026-05-09T11:00:00Z","ticket":"TEST-2","depth":1,"kind":"merge","detail":{"pr":"999"}}'
DETAIL='{"pr":"999"}'
dispatch_event "TEST-2" "merge" "$DETAIL" "$EVENT"

assert_eq "fifo called once"  "1" "${#FIFO_CALLS[@]}"
assert_eq "bell called once"  "1" "${#BELL_CALLS[@]}"
assert_eq "desktop NOT called" "0" "${#DESKTOP_CALLS[@]}"
assert_eq "slack NOT called"  "0" "${#SLACK_CALLS[@]}"
assert_contains "fifo got the event JSON" "999" "${FIFO_CALLS[0]:-}"
assert_contains "bell got pr=999 in body" "pr=999" "${BELL_CALLS[0]:-}"

echo
echo "=== dispatch_event — empty sink list is a no-op ==="
FIFO_CALLS=()
BELL_CALLS=()
cat >"$NOTIFY_CONFIG" <<'EOF'
[events]
review_comment = []
EOF

dispatch_event "TEST-2" "review_comment" '{"pr":"123"}' "$EVENT"
assert_eq "no sinks configured → no dispatch fifo" "0" "${#FIFO_CALLS[@]}"
assert_eq "no sinks configured → no dispatch bell" "0" "${#BELL_CALLS[@]}"

echo
echo "=== Result ==="
printf 'Passed: %d  Failed: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
