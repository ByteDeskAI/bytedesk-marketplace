#!/usr/bin/env bash
# TM-019 — the structured read surface: `tm show <id>` and `--json` on read verbs.
# Without this, the only way to query the store is to parse human text.
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

tm() { node "$PLUGIN_ROOT/bin/tm" "$@"; }
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected: $2 | got: ${1:0:200}" ;; esac; }
# json <payload> [jq args...] <filter> <name>
json() {
  local payload="$1"; shift
  local name="${*: -1}"; local filter="${*: -2:1}"; local args=("${@:1:$#-2}")
  echo "$payload" | jq -e "${args[@]}" "$filter" >/dev/null 2>&1 && ok "$name" || no "$name" "jq $filter failed on: ${payload:0:200}"
}

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

# tm why / tm graph — the transitive read. TM-002 blocks TM-001, TM-003 blocks TM-002,
# so the answer for TM-001 must name TM-003, not the neighbour the card already shows.
tm task new "Second task" >/dev/null
tm task new "Third task" >/dev/null
tm dep TM-001 TM-002 >/dev/null
tm dep TM-002 TM-003 >/dev/null
WHY="$(tm why TM-001)"
has "$WHY" "startable: no" "why reports a blocked task as not startable"
has "$WHY" "TM-003" "why walks past the direct blocker to the root"
has "$WHY" "start here: TM-003" "why names the task to actually pick up"
json "$(tm why TM-001 --json)" '.startable == false and (.roots | map(.id)) == ["TM-003"]' "why --json"
json "$(tm why TM-003 --json)" '.startable == true and (.reasons | length) == 0' "why on unblocked work"
tm why TM-404 >/dev/null 2>&1 && no "why fails on an unknown id" || ok "why fails on an unknown id"

GRAPH="$(tm graph)"
has "$GRAPH" '```mermaid' "graph is fenced for a PR diff by default"
has "$GRAPH" "TM_003 --> TM_002" "graph points blocker at blocked"
case "$(tm graph --raw)" in
  \`\`\`*) no "graph --raw drops the fence" "still fenced" ;;
  *) ok "graph --raw drops the fence" ;;
esac
json "$(tm graph --json)" '(.nodes | length) == 3 and (.edges | length) == 2' "graph --json is nodes and edges"

# tm log — the human branch must not be the JSON branch.
LOGOUT="$(tm log 20)"
case "$LOGOUT" in
  '{'*) no "tm log renders for a person, not as JSONL" "still starts with {" ;;
  *) ok "tm log renders for a person, not as JSONL" ;;
esac
has "$LOGOUT" "A task, epic or ADR is created" "tm log uses the catalog's own sentence per event"
has "$(tm log TM-001)" "→ " "tm log <id> shows the status path the task took"
has "$(tm log TM-001)" "TM-001" "tm log <id> names the entity"
json "$(tm log --json)" 'type == "array" and (.[0] | has("event"))' "log --json is unchanged"

# tm export — stdout by default so it pipes, --out to write.
has "$(tm export)" "# Board" "export defaults to a markdown report"
has "$(tm export csv)" "Issue ID,Summary" "export csv leads with Jira's headers"
json "$(tm export json)" '.tasks and .metrics and .exported' "export json carries tasks and metrics"
tm export xlsx >/dev/null 2>&1 && no "export refuses an unknown format" || ok "export refuses an unknown format"
tm export csv --out "$TM_ROOT/out.csv" >/dev/null
[[ -s "$TM_ROOT/out.csv" ]] && ok "export --out writes a file" || no "export --out writes a file"

# A reader that closes first is not an error. This needs a payload BIGGER than the 64 KB pipe
# buffer, or the write completes before the reader is gone and the bug hides — which is exactly
# why it never showed up on a fixture-sized store.
tm task new "the oversized one" >/dev/null 2>&1 || TM_ALLOW_DUP=1 tm task new "the oversized one" >/dev/null
BIGID=$(tm find "the oversized one" --json | jq -r '.[0].id')
node -e '
const fs = require("fs");
const f = process.argv[1];
fs.writeFileSync(f, fs.readFileSync(f, "utf8") + "\n" + "x".repeat(70000) + "\n");
' "$(tm show "$BIGID" --json | jq -r .file)"

quiet_pipe() {
  # $1 = the tm args; assert nothing lands on stderr when the reader exits early.
  ERRF="$TM_ROOT/pipe.err"
  # shellcheck disable=SC2086
  node "$PLUGIN_ROOT/bin/tm" $1 2>"$ERRF" | head -1 >/dev/null
  if [[ -s "$ERRF" ]]; then no "$2" "stderr: $(head -c 160 "$ERRF")"; else ok "$2"; fi
}
quiet_pipe "board --json" "board --json survives a reader that closes early"
quiet_pipe "export json" "export json survives a reader that closes early"
quiet_pipe "export md" "export md survives a reader that closes early"
quiet_pipe "log 5000 --json" "log --json survives a reader that closes early"

# And a reader that never reads at all.
node "$PLUGIN_ROOT/bin/tm" board --json 2>"$TM_ROOT/p2.err" | true
[[ -s "$TM_ROOT/p2.err" ]] && no "a reader that exits without reading is silent too" "$(head -c 160 "$TM_ROOT/p2.err")" || ok "a reader that exits without reading is silent too"

# The MCP server too: a vanished client must not produce a stack trace on a JSON-RPC stream.
printf '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"tm://board"}}\n' \
  | node "$PLUGIN_ROOT/bin/tm-mcp" 2>"$TM_ROOT/mcp.err" | true
[[ -s "$TM_ROOT/mcp.err" ]] && no "tm-mcp is silent when the client disappears" "$(head -c 160 "$TM_ROOT/mcp.err")" || ok "tm-mcp is silent when the client disappears"

# The human forms must not regress into JSON.
case "$(tm board)" in
  \{*) no "board without --json stays human" "got JSON" ;;
  *) ok "board without --json stays human" ;;
esac

# The order of `tm next` is the whole answer to "what should I work on", and it is what the
# SessionStart block and tm_next hand an agent. Asserted end to end, through the real CLI.
# Last in the file: these create tasks, and assertions above them count nodes and rows.
#
# Ids are read back rather than assumed. Nine tasks exist by now, so a hardcoded TM-002 would
# name "Second task" and the assertion would pass on a task this block never touched.
id_of() { tm find "$1" --json | jq -r '.[0].id'; }
tm task new "aaa the low one" >/dev/null
tm task new "zzz the urgent one" >/dev/null
LOW="$(id_of "aaa the low one")"
URGENT="$(id_of "zzz the urgent one")"
tm priority "$LOW" low >/dev/null
tm priority "$URGENT" highest >/dev/null
[[ "$URGENT" > "$LOW" ]] && ok "the urgent task has the later id, so id order would put it second" \
  || no "the urgent task has the later id" "$URGENT is not after $LOW"
json "$(tm next --json)" --arg u "$URGENT" '.[0].id == $u' "next puts the highest priority first, not the lowest id"
has "$(tm next)" "!highest" "the rendered line shows the priority the order is based on"

tm task new "placed by hand" >/dev/null
PLACED="$(id_of "placed by hand")"
tm rank "$PLACED" --before "$URGENT" >/dev/null
json "$(tm next --json)" --arg pl "$PLACED" '.[0].id == $pl' "an explicit rank outranks a priority label"

# field:value search — the questions the board in the browser could ask and the terminal could not.
env TM_ENFORCE=off node "$PLUGIN_ROOT/bin/tm" task new "a searchable bug" >/dev/null
BUGID="$(id_of "a searchable bug")"
tm type "$BUGID" bug >/dev/null
tm assign "$BUGID" ryan >/dev/null
tm label "$BUGID" ui >/dev/null
json "$(tm find type:bug --json)" --arg b "$BUGID" 'map(.id) | index($b) != null' "find narrows by issue type"
json "$(tm find assignee:ryan --json)" --arg b "$BUGID" 'map(.id) == [$b]' "find narrows by assignee"
json "$(tm find label:ui --json)" --arg b "$BUGID" 'map(.id) == [$b]' "find narrows by label"
json "$(tm find assignee:ryan type:bug --json)" --arg b "$BUGID" 'map(.id) == [$b]' "two filters AND"
json "$(tm find -assignee:ryan --json)" --arg b "$BUGID" 'map(.id) | index($b) == null' "a leading - negates"
json "$(tm find kind:adr --json)" 'all(.[]; .id | startswith("ADR-"))' "kind narrows to one entity type"
json "$(tm find "a searchable bug" --json)" --arg b "$BUGID" 'map(.id) | index($b) != null' "bare words still search titles"
tm find assigne:ryan >/dev/null 2>&1 && no "an unknown field is refused" || ok "an unknown field is refused"
has "$(tm find assigne:ryan 2>&1)" "use one of:" "the refusal lists the fields"
has "$(tm find nothingmatchesthis)" "no match for" "a no-match says what was searched"
# A url has a colon and must stay a search term rather than parsing as a field.
tm find "https://github.com/ByteDeskAI/x/pull/1" >/dev/null 2>&1 && ok "a url is a search term, not a field" || no "a url is a search term, not a field"

# The reason a task stopped, on the surfaces where you notice it stopped. `tm park`/`tm block`
# always stored it and neither the board nor `tm show` ever read it.
env TM_ENFORCE=off node "$PLUGIN_ROOT/bin/tm" task new "the stalled one" >/dev/null
STALLED="$(id_of "the stalled one")"
tm block "$STALLED" needs a call with the security team >/dev/null
has "$(tm board)" "needs a call with the security team" "the board says why a task is blocked"
has "$(tm show "$STALLED")" "blocked: needs a call with the security team" "tm show carries the reason in full"
has "$(tm find status:blocked)" "needs a call" "a filtered result carries it too"
tm unblock "$STALLED" >/dev/null
case "$(tm board)" in
  *"needs a call with the security team"*) no "unblocking drops the reason from the board" "still shown" ;;
  *) ok "unblocking drops the reason from the board" ;;
esac

# Goals are reachable as a resource and as a search field, not just as whichever id you remember.
printf '# A goal\n\n## Success criteria\n- it wakes within 400ms\n' > "$TM_ROOT/goal.md"
env TM_ENFORCE=off node "$PLUGIN_ROOT/bin/tm" goal import "$TM_ROOT/goal.md" >/dev/null 2>&1
has "$(tm find goal:goal.md)" "A goal" "goal: finds what a goal doc produced"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
