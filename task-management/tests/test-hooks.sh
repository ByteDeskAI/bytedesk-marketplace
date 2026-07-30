#!/usr/bin/env bash
# Hook contract: what each event puts on stdout, and that a hook never fails hard.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT
# The name Claude Code actually sets. The suites used to export CLAUDE_SESSION_ID, which
# nothing sets — so every session-dependent path was exercised with a variable production
# never had, and 9 suites stayed green while claims, gates and attribution were all inert.
export CLAUDE_CODE_SESSION_ID="test-session"
unset TM_ENFORCE
# The suite must not depend on the host's PATH. autolink() reports when something else
# already owns `tm` in ~/.local/bin, which is true for every checkout except whichever one
# the symlink points at — so running from a git worktree made "silent before init" fail on
# a systemMessage that has nothing to do with the hook under test.
export TM_NO_AUTOLINK=1
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

# SubagentStop attribution. The README promises a subagent's work is attributed on the timeline;
# it never was — 340 of these events in this project's own store, zero with a task attributed,
# 23 of them AFTER the change that claimed to fix it. That change guessed at the payload instead
# of reading Claude Code's schema, and the assertions here encoded the same guess: they fed
# `session_id` as if it were the subagent's, and passed only because this suite injects a session
# variable Claude Code does not set.
#
# Claude Code's own description of the event: "Input to command is JSON with agent_id, agent_type,
# and agent_transcript_path." session_id and transcript_path are the PARENT's, inherited from the
# base hook payload.
tm epic new "Subagent attribution" >/dev/null
tm task new "Work a subagent will do" >/dev/null
SAID=$(tm find "Work a subagent will do" --json | jq -r '.[0].id')
tm start "$SAID" >/dev/null

# The payload as Claude Code actually sends it: session_id/transcript_path are the parent's, and
# the subagent is agent_id/agent_type/agent_transcript_path.
OUT="$(hook subagent-stop '{"session_id":"test-session","transcript_path":"/tmp/parent.jsonl","agent_id":"agent-xyz","agent_type":"Explore","agent_transcript_path":"/tmp/agent.jsonl"}')"
LAST="$(tm log 1 --json)"
has "$LAST" '"agent": "agent-xyz"' "agent_id names the agent, not the parent's session id"
has "$LAST" '"agent_type": "Explore"' "the agent's type is recorded, so the timeline says what kind of agent it was"
has "$LAST" "\"$SAID\"" "the parent's claimed task is attributed to the fan-out"
has "$LAST" '"transcript": "/tmp/agent.jsonl"' "the agent's own transcript is carried, not the parent's"
case "$LAST" in
  *"/tmp/parent.jsonl"*) no "the parent's transcript is not passed off as the agent's" "recorded the parent's file" ;;
  *) ok "the parent's transcript is not passed off as the agent's" ;;
esac

# The variable Claude Code actually sets is the one that has to work. This suite exports
# CLAUDE_CODE_SESSION_ID; the plugin used to read CLAUDE_SESSION_ID alone, which nothing sets, so
# the claim lookup resolved against null and attributed nothing no matter what the payload said.
# Asserted with the legacy name explicitly unset, so it cannot pass by inheritance.
tm task new "Work under the real env var only" >/dev/null
RID=$(tm find "Work under the real env var only" --json | jq -r '.[0].id')
env -u CLAUDE_SESSION_ID CLAUDE_CODE_SESSION_ID=real-parent node "$PLUGIN_ROOT/bin/tm" start "$RID" >/dev/null
REALOUT="$(printf '{"session_id":"real-parent","agent_id":"agent-real","agent_transcript_path":"/tmp/a.jsonl"}' \
  | env -u CLAUDE_SESSION_ID CLAUDE_CODE_SESSION_ID=real-parent "$PLUGIN_ROOT/hooks/tm-hook.sh" subagent-stop 2>&1)"
has "$(tm log 1 --json)" "\"$RID\"" "a claim taken under CLAUDE_CODE_SESSION_ID is attributed"
has "$(tm log 2 --json)" '"session": "real-parent"' "the event log records which session wrote it"

# With nothing claimed there is nothing to attribute, and that must not error.
tm park "$SAID" done here >/dev/null
tm park "$RID" done here >/dev/null
hook subagent-stop '{"session_id":"test-session","agent_id":"agent-xyz"}' >/dev/null
has "$(tm log 1 --json)" '"tasks": []' "no claims means no attribution, not a failure"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
