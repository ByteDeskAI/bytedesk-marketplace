#!/usr/bin/env bash
# TM-381 / TM-357 / TM-359 (EP-028): a cross-repo ticket across two real temp stores.
#
# Repo A files a ticket on repo B with `tm ticket`; B's own tm creates it with A as origin, A's task
# is blocked by it, B's lead is mailed and B's pool is woken; B's progress comes back to A as one
# comment and one mail per event, and B's done clears A's blocker. agent-orchestration is a fake
# `ao-topology` (TM_TOPOLOGY_BIN) that records its argv — no real mail is ever sent.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
FAKE_HOME="$TMP/home"
PARENT="$TMP/src"
A="$PARENT/repo-a"
B="$PARENT/repo-b"
C="$TMP/elsewhere/repo-c"
AO_LOG="$TMP/ao.log"
mkdir -p "$FAKE_HOME" "$A" "$B" "$C"
trap 'rm -rf "$TMP"' EXIT
export HOME="$FAKE_HOME" TM_PLUGIN_ROOT="$PLUGIN_ROOT" CLAUDE_CODE_SESSION_ID="test-ticket"
export AGENT_ORCHESTRATION_STATE_HOME="$FAKE_HOME/ao" TM_NTFY_OFF=1
unset CLAUDE_PROJECT_DIR TM_ENFORCE

cat > "$TMP/ao-topology" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$AO_LOG"
EOF
chmod +x "$TMP/ao-topology"
export TM_TOPOLOGY_BIN="$TMP/ao-topology"

tm() { local root="$1"; shift; (cd "$root" && TM_ROOT="$root" node "$PLUGIN_ROOT/bin/tm" "$@"); }
field() { node -e 'let d=JSON.parse(require("fs").readFileSync(0,"utf8"));for(const k of process.argv[1].split("."))d=d?.[k];console.log(typeof d==="object"?JSON.stringify(d):d)' "$1"; }
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected: $2 | got: ${1:0:300}" ;; esac; }
lacks() { case "$1" in *"$2"*) no "$3" "did not expect: $2" ;; *) ok "$3" ;; esac; }
until_has() { for _ in $(seq 1 100); do case "$(eval "$1")" in *"$2"*) return 0 ;; esac; sleep 0.1; done; return 1; }

echo "test-ticket"

for r in "$A" "$B" "$C"; do
  tm "$r" init >/dev/null
  tm "$r" epic new "work" >/dev/null
  # No real pool may start in a temp store: `tm ticket` asks for one with `pool ensure`.
  tm "$r" config dispatch.enabled false >/dev/null
done
tm "$A" task new "origin work needs the widget" --body "context" --ac "it ships" >/dev/null

# ── TM-381 + TM-357: file by path, from a task ──────────────────────────────
res="$(tm "$A" ticket "$B" "Fix the widget" --priority critical --ac "the widget works" --from-task TM-001)"
has "$res" "repo-b#TM-001 filed" "tm ticket files the ticket on the target board"
show="$(tm "$B" show TM-001 --json)"
[[ "$(field origin.repo <<<"$show")" == "$A" ]] && ok "the ticket records origin.repo" || no "the ticket records origin.repo" "$(field origin <<<"$show")"
[[ "$(field origin.task <<<"$show")" == "TM-001" ]] && ok "the ticket records origin.task" || no "the ticket records origin.task"
[[ -n "$(field origin.agent <<<"$show")" ]] && ok "the ticket records origin.agent" || no "the ticket records origin.agent"
[[ "$(field priority <<<"$show")" == "highest" ]] && ok "critical is filed as highest" || no "critical is filed as highest" "$(field priority <<<"$show")"
has "$(field links <<<"$show")" "repo-a#TM-001" "the ticket carries a cross-ref back to the origin task"
has "$(tm "$A" show TM-001 --json | field links)" "repo-b#TM-001" "the origin task carries the cross-repo blocker"
has "$(tm "$A" why TM-001)" "waiting on cross-repo ticket repo-b#TM-001" "tm why shows the cross-repo blocker"
has "$(cat "$AO_LOG")" "mailbox send --to-repo $B --subject ticket TM-001 (critical)" "the target lead gets standing mail naming id and priority"
[[ "$(grep -c "^mailbox send" "$AO_LOG")" == 1 ]] && ok "exactly one notice" || no "exactly one notice" "$(cat "$AO_LOG")"
[[ -f "$B/.bytedesk/task-management/pool.wake" ]] && ok "the target pool's wake file is written" || no "the target pool's wake file is written"

# ── resolution: sibling slug, AO registry slug, refusal ─────────────────────
has "$(tm "$A" ticket repo-b "Second thing" --ac "done" 2>&1)" "repo-b#TM-002 filed" "a sibling slug resolves"
mkdir -p "$AGENT_ORCHESTRATION_STATE_HOME/services"
printf '{"repos":[{"key":"k1","consumer":"%s"}]}\n' "$C" > "$AGENT_ORCHESTRATION_STATE_HOME/services/repos.json"
has "$(tm "$A" ticket repo-c "Third thing" --ac "done" 2>&1)" "repo-c#TM-001 filed" "a slug in agent-orchestration's repos.json resolves"
out="$(tm "$A" ticket no-such-repo "x" --ac "y" 2>&1)"; code=$?
[[ $code == 2 ]] && has "$out" 'no repo named "no-such-repo"' "an unknown repo is refused" || no "an unknown repo is refused" "exit $code: $out"

# ── agent-orchestration absent ──────────────────────────────────────────────
lines="$(grep -c "^mailbox send" "$AO_LOG")"
res="$(TM_TOPOLOGY_BIN="" tm "$A" ticket "$B" "No AO here" --ac "done")"
has "$res" "agent-orchestration is not installed" "without AO the ticket is filed and says no mail was sent"
[[ "$(grep -c "^mailbox send" "$AO_LOG")" == "$lines" ]] && ok "without AO nothing is mailed" || no "without AO nothing is mailed"
mcp="$(cd "$A" && TM_ROOT="$A" TM_TOPOLOGY_BIN="" node --input-type=module -e "
import { callTool } from '$PLUGIN_ROOT/lib/mcp.mjs';
console.log(JSON.stringify(await callTool('tm_ticket', { target: '$B', title: 'Via MCP', priority: 'high', acceptance: ['works'] })));")"
has "$mcp" '"ref":"repo-b#TM-004"' "MCP tm_ticket files a ticket with AO absent"
# Through the real stdio server: the schema (its priority enum is built from the store's ladder)
# and the handler, end to end.
rpc="$(cd "$A" && printf '%s\n' \
  '{"jsonrpc":"2.0","id":0,"method":"initialize"}' \
  '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"tm_ticket\",\"arguments\":{\"target\":\"$B\",\"title\":\"Via the MCP server\",\"priority\":\"critical\",\"acceptance\":[\"works\"]}}}" \
  | TM_ROOT="$A" TM_TOPOLOGY_BIN="" node "$PLUGIN_ROOT/bin/tm-mcp" 2>&1)"
schema="$(grep '"id":1' <<<"$rpc" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));const t=r.result.tools.find((x)=>x.name==="tm_ticket");console.log(JSON.stringify(t?.inputSchema?.properties?.priority?.enum))')"
[[ "$schema" == '["critical","highest","high","medium","low","lowest"]' ]] && ok "the MCP server lists tm_ticket with the priority ladder" || no "the MCP server lists tm_ticket with the priority ladder" "$schema"
has "$(grep '"id":2' <<<"$rpc")" 'repo-b#TM-005' "the MCP server's tm_ticket call files a ticket"
[[ "$(tm "$B" show TM-005 --json | field priority)" == "highest" ]] && ok "the MCP-filed ticket is highest" || no "the MCP-filed ticket is highest"

# ── TM-359: progress events reach the origin task and lead ──────────────────
comments() { tm "$A" show TM-001 --json | field comments; }
tm "$B" ticket event TM-001 pr_opened https://github.com/o/repo-b/pull/7 >/dev/null
tm "$B" ticket event TM-001 review approved >/dev/null
tm "$B" ticket event TM-001 review approved >/dev/null # a repeat is a no-op
tm "$B" ticket notify '{"event":"task_result","id":"TM-001","outcome":"failed","run":"r1"}' >/dev/null
tm "$B" ticket event TM-001 published v1.2.3 >/dev/null
c="$(comments)"
has "$c" "repo-b#TM-001 pr_opened: https://github.com/o/repo-b/pull/7" "PR opened lands on the origin task"
has "$c" "repo-b#TM-001 review: approved" "a review verdict lands on the origin task"
has "$c" "repo-b#TM-001 failed: worker failed" "a worker failure lands on the origin task"
has "$c" "repo-b#TM-001 published: v1.2.3" "published lands on the origin task"
[[ "$(grep -o 'review: approved' <<<"$c" | wc -l)" == 1 ]] && ok "a repeated event comments once" || no "a repeated event comments once" "$c"
[[ "$(grep -c -- "--to-repo $A --subject repo-b#TM-001" "$AO_LOG")" == 4 ]] && ok "one origin mail per event" || no "one origin mail per event" "$(cat "$AO_LOG")"

# Done is logged by the target's own close; the logEvent bridge reports it (detached) and clears the blocker.
TM_ENFORCE=off tm "$B" done TM-001 >/dev/null
until_has "comments" "repo-b#TM-001 done" && ok "done reaches the origin task through the event bridge" || no "done reaches the origin task through the event bridge" "$(comments)"
until_has "tm $A why TM-001" "nothing is holding this up" && ok "done clears the origin's cross-repo blocker" || no "done clears the origin's cross-repo blocker" "$(tm "$A" why TM-001)"
lacks "$(tm "$A" show TM-001 --json | field links)" "repo-b#TM-001" "the blocker link is gone from the origin task"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
