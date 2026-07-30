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

# SubagentStart — the briefing. Claude Code sends the PARENT's session_id and delivers whatever
# `additionalContext` the hook returns into the subagent's context; both were established by
# spawning a real agent against a probe hook, not inferred from the schema.
tm epic new "Briefing" >/dev/null
tm task new "the task the parent is holding" >/dev/null
BID=$(tm find "the task the parent is holding" --json | jq -r '.[0].id')
tm ac "$BID" "the unmet one" >/dev/null
tm ac "$BID" "the met one" >/dev/null
tm accept "$BID" 2 >/dev/null

# Nothing claimed yet: a hook that prints an empty envelope on every spawn taxes every fan-out.
OUT="$(hook subagent-start '{"session_id":"test-session","agent_id":"a1","agent_type":"Explore"}')"
[[ -z "$OUT" ]] && ok "no claim means no output at all" || no "no claim means no output at all" "got: $OUT"

tm start "$BID" >/dev/null
OUT="$(hook subagent-start '{"session_id":"test-session","agent_id":"a1","agent_type":"Explore"}')"
has "$OUT" '"hookEventName":"SubagentStart"' "the envelope names the event it answers"
CTX="$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext')"
has "$CTX" "$BID" "the brief names the task the parent holds"
has "$CTX" "the unmet one" "it carries what is left to satisfy"
case "$CTX" in
  *"the met one"*) no "a criterion already met is left out" "found it" ;;
  *) ok "a criterion already met is left out" ;;
esac
has "$CTX" 'tm done' "it names the lifecycle verbs the agent must not run"
has "$CTX" 'tm comment' "it points at the additive writes so reporting back has a route"
case "$CTX" in
  *"Resume with: tm start"*) no "it is not the handoff dossier" "handoff's resume line leaked in" ;;
  *) ok "it is not the handoff dossier" ;;
esac

# Another session's spawn must not be handed this session's work.
OUT="$(hook subagent-start '{"session_id":"a-different-session","agent_id":"a2"}')"
[[ -z "$OUT" ]] && ok "a brief is scoped to the session that holds the claim" || no "a brief is scoped to the claiming session" "got: $OUT"
tm park "$BID" briefed >/dev/null

# SubagentStart — a spawned agent used to know nothing about the board. Claude Code fires this
# with the PARENT's session_id and takes additionalContext back; both were established by spawning
# a real agent against a probe hook, not inferred from the payload schema.
tm epic new "Briefing a subagent" >/dev/null
tm task new "the work the parent is holding" >/dev/null
BID=$(tm find "the work the parent is holding" --json | jq -r '.[0].id')
tm ac "$BID" "the unmet one is quoted" >/dev/null
tm ac "$BID" "the met one is not" >/dev/null
tm accept "$BID" 2 >/dev/null

# Nothing claimed yet: no output at all, not an empty envelope.
OUT="$(hook subagent-start '{"session_id":"test-session","agent_id":"a1"}')"
[[ -z "$OUT" ]] && ok "no claim means no briefing, not an empty one" || no "no claim means no briefing" "got: $OUT"

tm start "$BID" >/dev/null
OUT="$(hook subagent-start '{"session_id":"test-session","agent_id":"a1","agent_type":"general-purpose"}')"
has "$OUT" '"hookEventName":"SubagentStart"' "the briefing is returned as SubagentStart additionalContext"
has "$OUT" "$BID" "it names the task the parent holds"
has "$OUT" "the unmet one is quoted" "it carries what done still means"
case "$OUT" in
  *"the met one is not"*) no "a criterion already met is left out" "found it" ;;
  *) ok "a criterion already met is left out" ;;
esac
has "$OUT" 'tm done' "it tells the agent which verbs are the parent's to run"

# A different session's fan-out must not be briefed on this session's work.
OUT="$(hook subagent-start '{"session_id":"some-other-session","agent_id":"a2"}')"
[[ -z "$OUT" ]] && ok "another session's spawn gets no briefing" || no "another session's spawn gets no briefing" "got: $OUT"
tm park "$BID" done with the briefing fixture >/dev/null

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

# What the agent concluded, not where its transcript is filed. Claude Code puts the agent's closing
# message on the payload; the event used to record only a path nobody opens.
OUT="$(hook subagent-stop '{"session_id":"test-session","agent_id":"a-said","last_assistant_message":"## Result\n\nFound **3** callers of resolve() in useBoardKeys.ts."}')"
LAST="$(tm log 1 --json)"
has "$LAST" "Found 3 callers of resolve" "the agent's finding is on the timeline"
case "$LAST" in
  *'"said": "Result"'*) no "a markdown heading is not the finding" "took the heading" ;;
  *) ok "a markdown heading is not the finding" ;;
esac
case "$LAST" in
  *'**'*) no "inline emphasis is stripped for a plain log line" "found **" ;;
  *) ok "inline emphasis is stripped for a plain log line" ;;
esac
# Long answers are clamped — this line renders in tm log, the activity panel and a notification.
LONG=$(node -e 'process.stdout.write("x".repeat(900))')
hook subagent-stop "{\"session_id\":\"test-session\",\"agent_id\":\"a-long\",\"last_assistant_message\":\"$LONG\"}" >/dev/null
node -e '
const rows = JSON.parse(process.argv[1]);
const said = rows[0].said || "";
process.exit(said.length <= 240 && said.endsWith("\u2026") ? 0 : 1);
' "$(tm log 1 --json)" && ok "a long answer is clamped, visibly" || no "a long answer is clamped, visibly"
hook subagent-stop '{"session_id":"test-session","agent_id":"a-quiet"}' >/dev/null
case "$(tm log 1 --json)" in
  *'"said"'*) no "an agent that said nothing adds no empty field" "said was written" ;;
  *) ok "an agent that said nothing adds no empty field" ;;
esac

# With nothing claimed there is nothing to attribute, and that must not error.
tm park "$SAID" done here >/dev/null
tm park "$RID" done here >/dev/null
hook subagent-stop '{"session_id":"test-session","agent_id":"agent-xyz"}' >/dev/null
has "$(tm log 1 --json)" '"tasks": []' "no claims means no attribution, not a failure"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
