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

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
