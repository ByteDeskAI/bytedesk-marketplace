#!/usr/bin/env bash
# TM-019 — the structured read surface: `tm show <id>` and `--json` on read verbs.
# Without this, the only way to query the store is to parse human text.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT
export CLAUDE_SESSION_ID="test-session"
unset TM_ENFORCE
trap 'rm -rf "$TM_ROOT"' EXIT

tm() { node "$PLUGIN_ROOT/bin/tm" "$@"; }
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected: $2 | got: ${1:0:200}" ;; esac; }
json() { echo "$1" | jq -e "$2" >/dev/null 2>&1 && ok "$3" || no "$3" "jq $2 failed on: ${1:0:200}"; }

echo "test-read"

tm init >/dev/null
tm epic new "Read surface" >/dev/null
tm task new "First task" >/dev/null
tm ac TM-001 "it is queryable" >/dev/null
tm start TM-001 >/dev/null

# tm show
SHOW="$(tm show TM-001)"
has "$SHOW" "First task" "show renders a single task"
has "$SHOW" "it is queryable" "show includes acceptance criteria"
tm show TM-404 >/dev/null 2>&1 && no "show fails on an unknown id" || ok "show fails on an unknown id"
json "$(tm show TM-001 --json)" '.id == "TM-001" and .status == "in_progress"' "show --json is a single object"
json "$(tm show EP-001 --json)" '.id == "EP-001" and (.tasks | length) == 1' "show --json on an epic carries its children"

# --json on the read verbs
json "$(tm board --json)" '.epics and .tasks and (.tasks | length) == 1' "board --json"
json "$(tm next --json)" 'type == "array"' "next --json is an array"
json "$(tm find task --json)" '(. | length) >= 1 and .[0].id' "find --json"
json "$(tm stale --json)" 'type == "array"' "stale --json"
json "$(tm log --json)" 'type == "array" and (.[0] | has("event"))' "log --json"
json "$(tm log TM-001 --json)" 'all(.[]; .id == "TM-001")' "log <id> --json filters to one task"
json "$(tm standup --json)" 'has("events") or type == "array"' "standup --json"

# The human forms must not regress into JSON.
case "$(tm board)" in
  \{*) no "board without --json stays human" "got JSON" ;;
  *) ok "board without --json stays human" ;;
esac

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
