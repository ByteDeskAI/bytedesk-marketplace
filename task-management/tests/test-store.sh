#!/usr/bin/env bash
# Store + CLI behavior. Self-isolating: every run gets a fresh TM_ROOT.
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

assert_contains() { # <haystack> <needle> <name>
  case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected to contain: $2" ;; esac
}
assert_status() { # <expected-exit> <name> <cmd...>
  local want="$1" name="$2"; shift 2
  "$@" >/dev/null 2>&1
  local got=$?
  [[ "$got" == "$want" ]] && ok "$name" || no "$name" "exit $got, wanted $want"
}

echo "test-store"

tm init >/dev/null
[[ -d "$TM_ROOT/.bytedesk/task-management/tasks" ]] && ok "init creates the store" || no "init creates the store"

# Gate: no epic → TaskCreate path refuses (exit 2)
assert_status 2 "task create denied without an active epic" tm task new "orphan task"

tm epic new "Test epic" >/dev/null
assert_contains "$(tm epic)" "EP-001" "epic created and listed"
assert_contains "$(tm task new 'First real task')" "TM-001" "task created under the active epic"
assert_contains "$(cat "$TM_ROOT"/.bytedesk/task-management/tasks/TM-001-*.md)" 'epic: "EP-001"' "task carries the epic link"

# Duplicate guard
assert_status 2 "duplicate title is refused" tm task new "First real task"
TM_ALLOW_DUP=1 tm task new "First real task" >/dev/null && ok "TM_ALLOW_DUP bypasses the dup guard" || no "TM_ALLOW_DUP bypasses the dup guard"

# Acceptance criteria gate
tm ac TM-001 "the thing is verifiably true" >/dev/null
tm start TM-001 >/dev/null
assert_status 2 "done refused while acceptance criteria are unmet" tm done TM-001
tm accept TM-001 1 >/dev/null
assert_status 0 "done allowed once criteria are met" tm done TM-001
assert_contains "$(tm board)" "1/2 done" "board counts completion"

# Dependencies
tm task new "Blocked work" >/dev/null       # TM-003
tm task new "Blocker work" >/dev/null       # TM-004
tm dep TM-003 TM-004 >/dev/null
assert_contains "$(tm board)" "blocked-by TM-004" "dependency recorded"
case "$(tm next)" in *TM-003*) no "next hides blocked tasks" "TM-003 should not be next" ;; *) ok "next hides blocked tasks" ;; esac

# WIP limit
tm config wipLimit 1 >/dev/null
tm start TM-004 >/dev/null
assert_status 2 "WIP limit blocks a second in-progress task" tm start TM-003
tm override "testing the escape hatch" >/dev/null
assert_status 0 "override releases exactly one gate" tm start TM-003
assert_status 2 "override is one-shot" tm start TM-002
tm config wipLimit 3 >/dev/null

# Enforcement kill switch
assert_status 0 "TM_ENFORCE=off opens every gate" env TM_ENFORCE=off node "$PLUGIN_ROOT/bin/tm" task new "First real task"

# Evidence + git-style linkage
echo "log output" | tm evidence TM-003 - >/dev/null
assert_contains "$(tm handoff TM-003)" "Evidence" "evidence attaches to the task"
tm link TM-003 abc1234 >/dev/null
assert_contains "$(tm handoff TM-003)" "abc1234" "commit refs attach to the task"

# Index is a derived cache
BEFORE="$(tm board)"
rm "$TM_ROOT/.bytedesk/task-management/index.json"
tm reindex >/dev/null
[[ "$BEFORE" == "$(tm board)" ]] && ok "board survives losing index.json" || no "board survives losing index.json"

# tm reopen — the way back, and what it takes with it.
tm task new "Reopen target task" >/dev/null
RID=$(tm find "Reopen target task" --json | jq -r '.[0].id')
tm ac "$RID" "it is closed" >/dev/null; tm accept "$RID" 1 >/dev/null; tm done "$RID" >/dev/null
tm task new "Still open on purpose" >/dev/null
OPENID=$(tm find "Still open on purpose" --json | jq -r '.[0].id')
assert_status 2 "reopen refuses a task that is not done" node "$PLUGIN_ROOT/bin/tm" reopen "$OPENID"
assert_contains "$(tm reopen "$RID" changed my mind)" "reopened" "reopen brings a done task back"
assert_contains "$(tm show "$RID")" "changed my mind" "reopen records why"
case "$(tm show "$RID" --json)" in
  *'"closed"'*) no "reopen clears the closed date" "closed is still in the record" ;;
  *) ok "reopen clears the closed date" ;;
esac
tm done "$RID" >/dev/null 2>&1 || true
assert_contains "$(tm start "$RID" 2>&1)" "reopened from done" "start on a done task says it reopened"

# tm doctor — the exit code is the contract: it is meant to gate a commit or a CI step.
assert_status 0 "doctor exits 0 on a healthy store" node "$PLUGIN_ROOT/bin/tm" doctor
STORE="$TM_ROOT/.bytedesk/task-management"
sed -i 's/^blockedBy: .*/blockedBy: ["TM-404"]/' "$STORE"/tasks/TM-003-*.md
assert_status 1 "doctor exits 1 on an error-level finding" node "$PLUGIN_ROOT/bin/tm" doctor
assert_contains "$(tm doctor || true)" "TM-404" "doctor names the broken reference"
assert_contains "$(tm doctor --fix)" "dropped TM-404" "doctor --fix says what it changed"
assert_status 0 "and the store is clean afterwards" node "$PLUGIN_ROOT/bin/tm" doctor

# Event log
assert_contains "$(tm log 100)" '"event":"done"' "events are logged"
assert_contains "$(tm standup 2000-01-01T00:00:00Z)" "TM-001" "standup reads the event log"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
