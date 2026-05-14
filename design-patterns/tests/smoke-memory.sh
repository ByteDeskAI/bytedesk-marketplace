#!/usr/bin/env bash
# Smoke test for design-patterns cross-session pattern memory (BDM-52).
# Exercises the CLI (`patterns memory ...`, `patterns adr`) and the MCP stdio
# server end-to-end against a throwaway project. Self-isolating: a temp project
# dir plus a temp CLAUDE_PLUGIN_DATA, both removed on exit — never touches a
# real journal.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATTERNS="$ROOT/bin/patterns"
MCP="$ROOT/bin/patterns-mcp"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PROJECT="$TMP/proj"
mkdir -p "$PROJECT/.git"
cd "$PROJECT"
export PWD="$PROJECT"
export CLAUDE_PLUGIN_DATA="$TMP/_global"

pass() { echo "  ok: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

echo "smoke-memory.sh: CLI"

python3 "$PATTERNS" memory where --json | grep -q '"mode": "project"' \
  || fail "memory where: expected project mode"
pass "memory where reports project mode"

python3 "$PATTERNS" memory record --kind applied --pattern strategy \
  --target src/providers.py --summary "extracted ProviderStrategy" --json \
  | grep -q '"kind": "applied"' || fail "memory record: expected an applied event"
pass "memory record --kind applied"

JOURNAL="$PROJECT/.claude/plugins/design-patterns/journal.jsonl"
[ -f "$JOURNAL" ] || fail "journal.jsonl was not created"
python3 -c "import json,sys; [json.loads(l) for l in open(sys.argv[1]) if l.strip()]" "$JOURNAL" \
  || fail "journal.jsonl contains invalid JSON"
pass "journal.jsonl exists and is valid JSONL"

python3 "$PATTERNS" memory recall --json | grep -q '"appliedCount": 1' \
  || fail "memory recall: expected appliedCount 1"
pass "memory recall reflects the recorded refactor"

python3 "$PATTERNS" adr "durable SSE event storage: Redis vs PostgreSQL" --json \
  | grep -q '"adrNumber"' || fail "patterns adr: expected an adrNumber"
[ -f "$PROJECT/.claude/plugins/design-patterns/index.md" ] \
  || fail "index.md was not rendered"
ls "$PROJECT/.claude/plugins/design-patterns/decisions/"*.md >/dev/null 2>&1 \
  || fail "no decision markdown was rendered"
pass "patterns adr auto-records + renders decisions/ and index.md"

echo "smoke-memory.sh: MCP stdio"

REQ='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"patterns_record","arguments":{"kind":"applied","pattern":"adapter","target":"src/legacy.py"}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"patterns_recall","arguments":{}}}'
RESP="$(printf '%s\n' "$REQ" | "$MCP")"

echo "$RESP" | grep -q 'patterns_recall' || fail "tools/list missing patterns_recall"
echo "$RESP" | grep -q 'patterns_record' || fail "tools/list missing patterns_record"
pass "tools/list exposes patterns_record + patterns_recall"

echo "$RESP" | python3 -c '
import json, sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    if msg.get("id") == 4:
        payload = json.loads(msg["result"]["content"][0]["text"])
        assert payload["appliedCount"] == 2, payload
        sys.exit(0)
sys.exit("id 4 (patterns_recall) response not found")
' || fail "MCP record -> recall round-trip did not show 2 applied events"
pass "MCP patterns_record -> patterns_recall round-trips over stdio"

echo "smoke-memory.sh: ALL PASS"
