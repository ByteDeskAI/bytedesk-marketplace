#!/usr/bin/env bash
# TM-070 — the machine-consumable event stream: `tm events` as a snapshot, as JSONL,
# with --since, and as a --follow tail that survives rotation and exits cleanly.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT
# The name Claude Code actually sets. The suites used to export CLAUDE_SESSION_ID, which
# nothing sets — so every session-dependent path was exercised with a variable production
# never had, and 9 suites stayed green while claims, gates and attribution were all inert.
export CLAUDE_CODE_SESSION_ID="test-session"
unset TM_ENFORCE
# The real node binary, not a volta/nvm shim: the follow test sends SIGINT to $! and
# waits on its exit code — a shim would sit between us and the process and swallow both.
NODE="$(node -p 'process.execPath')"
trap 'rm -rf "$TM_ROOT"' EXIT

tm() { "$NODE" "$PLUGIN_ROOT/bin/tm" "$@"; }
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected: $2 | got: ${1:0:200}" ;; esac; }

echo "test-events"

tm init >/dev/null
tm epic new "Event stream" >/dev/null
tm task new "First task" >/dev/null

# Snapshot: human by default, with the catalog's own sentence per event.
OUT="$(tm events)"
case "$OUT" in
  '{'*) no "events stays human by default" "got JSON" ;;
  *) ok "events stays human by default" ;;
esac
has "$OUT" "A task, epic or ADR is created" "events uses the catalog label"
has "$(tm help)" "events" "help lists the events verb"

# --json is the raw stream: JSONL, one full row per line, not the pretty array.
J="$(tm events --json)"
case "$J" in
  '['*) no "events --json is JSONL, not the pretty array" "starts with [" ;;
  *) ok "events --json is JSONL, not the pretty array" ;;
esac
if echo "$J" | jq -e 'has("ts") and has("event") and has("session") and has("actor")' >/dev/null 2>&1; then
  ok "events --json lines are the full event row"
else
  no "events --json lines are the full event row" "${J:0:200}"
fi
[[ "$(tm events 2 --json | wc -l)" == 2 ]] && ok "events n caps the tail" || no "events n caps the tail" "$(tm events 2 --json | wc -l) lines"

# --since
[[ -z "$(tm events --json --since 2999-01-01T00:00:00.000Z)" ]] && ok "--since filters everything out" || no "--since filters everything out"
has "$(tm events --json --since 2000-01-01T00:00:00.000Z)" '"event"' "--since keeps recent rows"
tm events --since nonsense >/dev/null 2>&1 && no "a bad --since is refused" || ok "a bad --since is refused"

# --follow: print new lines as they appear, survive rotation, exit 0 on SIGINT.
# Backgrounded directly, not through tm(): a backgrounded function call forks a
# subshell, $! is the subshell, and SIGINT would land on it instead of the tail.
EVENTS_FILE="$TM_ROOT/.bytedesk/task-management/events.jsonl"
"$NODE" "$PLUGIN_ROOT/bin/tm" events --follow --json >"$TM_ROOT/follow.out" 2>"$TM_ROOT/follow.err" &
FPID=$!
sleep 1 # the tail polls on a 500ms tick — give it one full tick to start
wait_line() {
  for _ in $(seq 1 24); do
    grep -q "$1" "$TM_ROOT/follow.out" && return 0
    sleep 0.25
  done
  return 1
}

printf '%s\n' '{"ts":"2026-09-02T00:00:01.000Z","event":"comment","session":"s1","actor":"tester","id":"TM-999","text":"hello-follow"}' >>"$EVENTS_FILE"
wait_line "hello-follow" && ok "follow prints a line written after start" || no "follow prints a line written after start" "$(cat "$TM_ROOT/follow.err")"

# Rotation: the file is replaced and shrinks — the tail must reopen and continue.
mv "$EVENTS_FILE" "$TM_ROOT/.bytedesk/task-management/events.1.jsonl"
printf '%s\n' '{"ts":"2026-09-02T00:00:02.000Z","event":"done","session":"s1","actor":"tester","id":"TM-999","note":"post-rotation"}' >"$EVENTS_FILE"
wait_line "post-rotation" && ok "follow survives rotation" || no "follow survives rotation" "$(cat "$TM_ROOT/follow.out")"

kill -INT "$FPID" 2>/dev/null
if wait "$FPID"; then
  ok "follow exits 0 on SIGINT"
else
  no "follow exits 0 on SIGINT" "exit $?"
fi

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
