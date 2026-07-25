#!/usr/bin/env bash
# MCP stdio server, driven the way a client drives it. Self-isolating: fresh TM_ROOT.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT
export CLAUDE_SESSION_ID="test-session"
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

# Acceptance gate, over the wire.
{ call tm_ac_add '{"id":"TM-001","text":"verifiably true"}'; } | mcp >/dev/null
OUT="$(call tm_task_update '{"id":"TM-001","action":"done"}' | mcp)"
assert_contains "$OUT" "unmet acceptance criteria" "done is gated on acceptance criteria"
{ call tm_ac_accept '{"id":"TM-001","index":1}'; } | mcp >/dev/null
OUT="$(call tm_task_update '{"id":"TM-001","action":"done"}' | mcp)"
assert_contains "$OUT" '\"ok\": true' "done allowed once criteria are met"

# Protocol errors.
OUT="$(printf '{"jsonrpc":"2.0","id":3,"method":"resources/list"}\n' | mcp)"
assert_contains "$OUT" '"code":-32601' "unknown method is -32601"
OUT="$(printf '{not json\n' | mcp)"
assert_contains "$OUT" '"code":-32700' "unparseable line is -32700"
assert_contains "$OUT" '"id":null' "parse errors carry a null id"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
