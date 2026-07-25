#!/usr/bin/env bash
# Hook contract: what each event puts on stdout, and that a hook never fails hard.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT
export CLAUDE_SESSION_ID="test-session"
unset TM_ENFORCE
trap 'rm -rf "$TM_ROOT"' EXIT

hook() { echo "${2:-\{\}}" | "$PLUGIN_ROOT/hooks/tm-hook.sh" "$1" 2>/dev/null; }
tm() { node "$PLUGIN_ROOT/bin/tm" "$@"; }
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected: $2 | got: ${1:0:200}" ;; esac; }
empty() { [[ -z "$1" ]] && ok "$2" || no "$2" "expected no output, got: ${1:0:200}"; }

echo "test-hooks"

# Uninitialized store must be inert, never noisy.
empty "$(hook session-start)" "session-start is silent before init"
empty "$(hook stop)" "stop is silent before init"

tm init >/dev/null

# PreToolUse gate
DENY="$(hook pre-task-create '{"tool_name":"TaskCreate","tool_input":{"subject":"x","description":"y"}}')"
has "$DENY" '"permissionDecision":"deny"' "TaskCreate denied with no active epic"
has "$DENY" 'tm epic use' "denial explains how to proceed"

tm epic new "Hook epic" >/dev/null
empty "$(hook pre-task-create '{"tool_name":"TaskCreate"}')" "TaskCreate allowed once an epic is active"

# PostToolUse mirroring
hook post-task '{"tool_name":"TaskCreate","tool_input":{"subject":"Mirrored task","description":"the body","activeForm":"Mirroring"},"tool_response":{"id":"42"}}' >/dev/null
has "$(tm board)" "Mirrored task" "TaskCreate is mirrored into the store"
has "$(cat "$TM_ROOT"/.bytedesk/task-management/tasks/TM-001-*.md)" 'nativeId: "42"' "native id is recorded"

hook post-task '{"tool_name":"TaskUpdate","tool_input":{"taskId":"42","status":"in_progress"}}' >/dev/null
has "$(tm board)" "## in progress" "native in_progress is mirrored"

# Stop gate: blocks once, then releases (never traps a session)
has "$(hook stop)" '"decision":"block"' "stop blocks on in-progress work"
empty "$(hook stop)" "stop never blocks twice on the same task set"

hook post-task '{"tool_name":"TaskUpdate","tool_input":{"taskId":"42","status":"completed"}}' >/dev/null
has "$(tm board)" "1/1 done" "native completed is mirrored"
empty "$(hook stop)" "stop is silent with nothing in progress"

# SessionStart injection
has "$(hook session-start)" '"hookEventName":"SessionStart"' "session-start emits context"

# Decision capture — a real choice between options is recorded (TM-016)
REAL_DECISION='{"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"Which store?","header":"Storage","options":[{"label":"Markdown","description":"git-diffable files"},{"label":"SQLite","description":"opaque but fast"}]}]},"tool_response":{"answers":{"Which store?":"Markdown"}}}'
hook post-decision "$REAL_DECISION" >/dev/null
has "$(tm find Storage)" "ADR-0001" "a genuine multi-option decision becomes an ADR"
has "$(tm show ADR-0001)" "SQLite" "the rejected option is recorded — alternatives are the point of an ADR"

# ...and asking the same thing again updates that ADR instead of spawning a twin
hook post-decision "$REAL_DECISION" >/dev/null
[[ "$(tm find Storage --json | jq 'length')" == 1 ]] && ok "the same decision does not create a second ADR" || no "the same decision does not create a second ADR"

# A throwaway clarification is NOT worth an ADR
hook post-decision '{"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"Which file did you mean?","header":"File","options":[{"label":"src/index.ts","description":""}]}]},"tool_response":{"answers":{"Which file did you mean?":"src/index.ts"}}}' >/dev/null
[[ "$(tm find File --json | jq 'length')" == 0 ]] && ok "a single-option clarification is skipped" || no "a single-option clarification is skipped"

# Kill switch
export TM_ENFORCE=off
tm task new "unlinked work" >/dev/null 2>&1
empty "$(hook pre-task-create '{"tool_name":"TaskCreate"}')" "TM_ENFORCE=off opens the PreToolUse gate"
unset TM_ENFORCE

# Robustness: garbage in, exit 0 out
echo 'not json' | "$PLUGIN_ROOT/hooks/tm-hook.sh" post-task >/dev/null 2>&1 && ok "malformed payload still exits 0" || no "malformed payload still exits 0"
"$PLUGIN_ROOT/hooks/tm-hook.sh" </dev/null >/dev/null 2>&1 && ok "missing event name still exits 0" || no "missing event name still exits 0"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
