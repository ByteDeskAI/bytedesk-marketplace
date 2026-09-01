#!/usr/bin/env bash
# MCP stdio server, driven the way a client drives it. Self-isolating: fresh TM_ROOT.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT
# The name Claude Code actually sets. The suites used to export CLAUDE_SESSION_ID, which
# nothing sets — so every session-dependent path was exercised with a variable production
# never had, and 9 suites stayed green while claims, gates and attribution were all inert.
export CLAUDE_CODE_SESSION_ID="test-session"
unset TM_ENFORCE
trap 'rm -rf "$TM_ROOT"' EXIT

mcp() { node "$PLUGIN_ROOT/bin/tm-mcp"; }   # reads request lines on stdin
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }

assert_contains() { # <haystack> <needle> <name>
  case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected to contain: $2" ;; esac
}

# Response lines in a captured (trailing-newline-stripped) block.
lines() { printf '%s\n' "$1" | grep -c ''; }

# A tools/call request line. <name> <json-arguments>
call() { printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}\n' "$1" "$2"; }

echo "test-mcp"

node "$PLUGIN_ROOT/bin/tm" init >/dev/null

OUT="$(printf '{"jsonrpc":"2.0","id":0,"method":"initialize"}\n' | mcp)"
assert_contains "$OUT" '"protocolVersion":"2024-11-05"' "initialize returns the protocol version"
assert_contains "$OUT" '"name":"task-management"' "initialize names the server"
[[ "$(lines "$OUT")" == 1 ]] && ok "one JSON object per line" || no "one JSON object per line"

# A notification is answered with silence, not with an empty result.
OUT="$(printf '{"jsonrpc":"2.0","method":"notifications/initialized"}\n' | mcp)"
[[ -z "$OUT" ]] && ok "notifications/initialized produces no output line" || no "notifications/initialized produces no output line" "got: $OUT"

OUT="$(printf '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' | mcp)"
assert_contains "$OUT" '"tm_task_create"' "tools/list advertises the tools"
assert_contains "$OUT" '"inputSchema"' "tools carry a JSON Schema"

# Gates apply to MCP exactly as they do to the CLI.
OUT="$(call tm_task_create '{"title":"orphan task"}' | mcp)"
assert_contains "$OUT" "no active epic" "task create is denied without an active epic"

OUT="$({ call tm_epic '{"action":"new","title":"Test epic"}'; call tm_task_create '{"title":"First real task"}'; } | mcp)"
assert_contains "$OUT" "EP-001" "epic created over the wire"
assert_contains "$OUT" "TM-001" "task created under the active epic"
[[ "$(lines "$OUT")" == 2 ]] && ok "two requests, two response lines" || no "two requests, two response lines"

# The store the CLI sees is the same store.
assert_contains "$(node "$PLUGIN_ROOT/bin/tm" board)" "TM-001" "the CLI sees what MCP wrote"

# tm_why over the wire: a tool that isn't reachable from MCP is a silent gap.
OUT="$({ call tm_task_create '{"title":"A blocking prerequisite"}'; } | mcp)"
node "$PLUGIN_ROOT/bin/tm" dep TM-001 TM-002 >/dev/null
OUT="$(call tm_why '{"id":"TM-001"}' | mcp)"
# The result is JSON-in-a-string inside content[0].text, so the quotes arrive escaped.
assert_contains "$OUT" 'startable' "tm_why answers over MCP"
assert_contains "$OUT" "TM-002" "tm_why names the blocker"

# Acceptance gate, over the wire.
{ call tm_ac_add '{"id":"TM-001","text":"verifiably true"}'; } | mcp >/dev/null
OUT="$(call tm_task_update '{"id":"TM-001","action":"done"}' | mcp)"
assert_contains "$OUT" "unmet acceptance criteria" "done is gated on acceptance criteria"
{ call tm_ac_accept '{"id":"TM-001","index":1}'; } | mcp >/dev/null
OUT="$(call tm_task_update '{"id":"TM-001","action":"done"}' | mcp)"
assert_contains "$OUT" '\"ok\": true' "done allowed once criteria are met"

# tm_task_edit — a tool that isn't reachable from MCP is a silent gap, and for a long time
# correcting a title was reachable only from the browser.
OUT="$(call tm_task_edit '{"id":"TM-001","title":"corrected over the wire"}' | mcp)"
# The result reports which fields changed, not the new values — the caller supplied those.
assert_contains "$OUT" 'edited' "tm_task_edit reports what it changed"
assert_contains "$(node "$PLUGIN_ROOT/bin/tm" show TM-001)" "corrected over the wire" "the CLI sees the correction"
OUT="$(call tm_task_edit '{"id":"TM-001"}' | mcp)"
assert_contains "$OUT" "needs a title, a body or an epic" "tm_task_edit with no field is refused rather than a silent no-op"
OUT="$(call tm_task_edit '{"id":"TM-001","epic":"EP-404"}' | mcp)"
assert_contains "$OUT" "not found: EP-404" "a move to a missing epic is refused over the wire, not thrown"

# tm_find takes the same field:value query the CLI does — an agent asking the board a question
# directly instead of reading the whole board and filtering it itself.
node "$PLUGIN_ROOT/bin/tm" type TM-001 bug >/dev/null
OUT="$(call tm_find '{"query":"type:bug"}' | mcp)"
assert_contains "$OUT" "TM-001" "tm_find narrows by field over MCP"
OUT="$(call tm_find '{"query":"type:story"}' | mcp)"
assert_contains "$OUT" '\"hits\": []' "a field that does not match returns no hits"
OUT="$(call tm_find '{"query":"assigne:ryan"}' | mcp)"
assert_contains "$OUT" "unknown search field" "an unknown field is refused over the wire, not thrown"

# Acceptance criteria over the wire: an agent that mis-ticks must be able to put it back.
{ call tm_ac_add '{"id":"TM-001","text":"the undoable one"}'; } | mcp >/dev/null
OUT="$(call tm_ac_accept '{"id":"TM-001","index":1,"undo":true}' | mcp)"
assert_contains "$OUT" '\"ok\": true' "tm_ac_accept unticks with undo"
OUT="$(call tm_ac_accept '{"id":"TM-001","index":1,"remove":true}' | mcp)"
assert_contains "$OUT" "removed" "tm_ac_accept removes a criterion"
OUT="$(call tm_ac_accept '{"id":"TM-001","index":99}' | mcp)"
assert_contains "$OUT" "no acceptance criterion 99" "a bad index is refused, not thrown"

# Protocol errors.
# Resources: the board as context the user pulls, over the real stdio server.
OUT="$(printf '{"jsonrpc":"2.0","id":10,"method":"initialize"}\n' | mcp)"
assert_contains "$OUT" '"resources":{}' "initialize declares the resources capability"
assert_contains "$OUT" '"tools":{}' "initialize declares the tools capability"

OUT="$(printf '{"jsonrpc":"2.0","id":11,"method":"resources/list"}\n' | mcp)"
assert_contains "$OUT" 'tm://board' "resources/list offers the board"
assert_contains "$OUT" 'tm://graph' "resources/list offers the dependency graph"
assert_contains "$OUT" 'text/markdown' "resources carry a mime type"

OUT="$(printf '{"jsonrpc":"2.0","id":12,"method":"resources/read","params":{"uri":"tm://board"}}\n' | mcp)"
assert_contains "$OUT" '"contents"' "resources/read returns contents, plural"
assert_contains "$OUT" 'tm://board' "the entry echoes the requested uri"
case "$OUT" in
  *'"content":'*) no "read does not use the tools/call key" "found \"content\":" ;;
  *) ok "read does not use the tools/call key" ;;
esac

OUT="$(printf '{"jsonrpc":"2.0","id":13,"method":"resources/read","params":{"uri":"tm://task/TM-999"}}\n' | mcp)"
assert_contains "$OUT" '"code":-32002' "an unknown resource is -32002, not -32601"

# A method the server genuinely does not implement — resources/list is real now.
OUT="$(printf '{"jsonrpc":"2.0","id":3,"method":"completion/complete"}\n' | mcp)"
assert_contains "$OUT" '"code":-32601' "unknown method is -32601"
OUT="$(printf '{not json\n' | mcp)"
assert_contains "$OUT" '"code":-32700' "unparseable line is -32700"
assert_contains "$OUT" '"id":null' "parse errors carry a null id"


# ── parity with the dashboard's write surface (CAP-0001) ─────────────────────
# Every verb the board can do, an MCP-only session can do. Count first: a tool that is defined
# but not advertised is invisible to a client.
OUT="$(printf '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' | mcp)"
COUNT="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.tools.length))' <<<"$OUT")"
[[ "$COUNT" == 35 ]] && ok "tools/list advertises 35 tools" || no "tools/list advertises 35 tools" "got $COUNT"
for TOOL in tm_worktree tm_link tm_graph tm_doctor tm_export tm_time tm_parallel tm_task_field tm_history tm_stale tm_goal_import; do
  assert_contains "$OUT" "\"$TOOL\"" "tools/list advertises $TOOL"
done

# Fresh tasks, so this block does not depend on what the suite above did to TM-001.
id_of() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(JSON.parse(s).result.content[0].text).id))'; }
A="$(call tm_task_create '{"title":"Parity A"}' | mcp | id_of)"
B="$(call tm_task_create '{"title":"Parity B"}' | mcp | id_of)"
OUT="$(call tm_link "{\"id\":\"$A\",\"type\":\"blocks\",\"to\":\"$B\"}" | mcp)"
assert_contains "$OUT" '\"type\": \"blocks\"' "tm_link writes the near end"
assert_contains "$(node "$PLUGIN_ROOT/bin/tm" show "$B")" "blocked by" "the CLI sees the mirrored end"
OUT="$(call tm_link "{\"id\":\"$A\",\"type\":\"blocks\",\"to\":\"$B\",\"remove\":true}" | mcp)"
assert_contains "$OUT" '\"links\": []' "tm_link remove leaves the near end clean"
OUT="$(call tm_task_field "{\"id\":\"$B\",\"dep\":{\"add\":[\"$A\"]},\"priority\":\"high\"}" | mcp)"
assert_contains "$OUT" '\"blockedBy\": [' "tm_task_field writes a dependency"
assert_contains "$OUT" '\"priority\": \"high\"' "tm_task_field writes a priority"
OUT="$(call tm_graph '{}' | mcp)"
assert_contains "$OUT" 'flowchart' "tm_graph renders mermaid"
assert_contains "$OUT" '\"edges\": [' "tm_graph returns edges"
OUT="$(call tm_doctor '{"fix":true}' | mcp)"
assert_contains "$OUT" 'confirm' "tm_doctor fix without confirm is refused"
OUT="$(call tm_doctor '{}' | mcp)"
assert_contains "$OUT" '\"findings\": [' "tm_doctor reports findings"
OUT="$(call tm_export '{"format":"csv"}' | mcp)"
assert_contains "$OUT" 'Summary' "tm_export csv carries Jira's header"
OUT="$(call tm_time '{}' | mcp)"
assert_contains "$OUT" '\"throughput\"' "tm_time summarises the board"
OUT="$(call tm_parallel '{}' | mcp)"
assert_contains "$OUT" '\"batches\": [' "tm_parallel returns batches"
OUT="$(call tm_history "{\"id\":\"$A\"}" | mcp)"
assert_contains "$OUT" '\"label\"' "tm_history labels events"
OUT="$(call tm_stale '{}' | mcp)"
assert_contains "$OUT" '\"minutes\"' "tm_stale reports the threshold"
printf '# Goal: Imported over MCP\n\n## Success criteria\n\n- it lands\n' > "$TM_ROOT/goal.md"
OUT="$(call tm_goal_import '{"path":"goal.md"}' | mcp)"
assert_contains "$OUT" '\"criteria\": 1' "tm_goal_import turns a doc into a gated task"
OUT="$(call tm_goal_import '{"path":"../outside.md"}' | mcp)"
assert_contains "$OUT" 'inside' "tm_goal_import refuses a path outside the repo"
OUT="$(call tm_worktree '{"action":"list"}' | mcp)"
assert_contains "$OUT" '\"worktrees\": [' "tm_worktree list reads (a bare store has none)"
OUT="$(call tm_task_update "{\"id\":\"$B\",\"action\":\"delete\",\"reason\":\"dup\"}" | mcp)"
assert_contains "$OUT" '\"status\": \"deleted\"' "tm_task_update delete is soft"
OUT="$(call tm_task_update "{\"id\":\"$B\",\"action\":\"restore\"}" | mcp)"
assert_contains "$OUT" '\"status\": \"blocked\"' "tm_task_update restore brings it back where it was (blocked by A)"

# ── the server is harness-agnostic (TM-039) ──────────────────────────────────
# Driven the way Codex and Grok drive it: their own client identity, their own session variable,
# and no Claude Code variable anywhere. The MCP surface is the one part that needs no adapter, and
# the capability matrix in README.md claims exactly that — so it gets checked.
for HARNESS in codex grok; do
  case "$HARNESS" in
    codex) SESSION_VAR=CODEX_THREAD_ID ;;
    grok)  SESSION_VAR=GROK_SESSION_ID ;;
  esac
  OUT="$(printf '%s\n' \
    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"$HARNESS\",\"version\":\"1\"}}}" \
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tm_board","arguments":{}}}' \
    | env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_SESSION_ID "$SESSION_VAR=s-1" node "$PLUGIN_ROOT/bin/tm-mcp" 2>/dev/null)"
  # The board text arrives JSON-escaped inside the tool result, so match the content, not the shape.
  case "$OUT" in
    *Board*) ok "the MCP server answers $HARNESS with no Claude Code variable set" ;;
    *) no "the MCP server answers $HARNESS with no Claude Code variable set" "${OUT:0:200}" ;;
  esac
done

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
