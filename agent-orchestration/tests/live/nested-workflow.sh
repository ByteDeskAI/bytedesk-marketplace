#!/usr/bin/env bash
# A workflow that contains another workflow, exercised the way a consumer would use it.
#
# The claim under test: a child workflow is a PARTICIPANT — the conductor addresses it by id exactly
# like an agent, sends to it, and waits on it, without ever learning it is a team in another tmux
# session. Everything below goes through the CLI against real tmux and real files.
#
# It needs tmux and node. It does NOT need a model: agents launch on the `generic` adapter running
# `cat`, an interactive process that sits in a pane exactly like a CLI would. What is under test is
# the orchestration layer, not the agent.
#
#   bash tests/live/nested-workflow.sh
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PLUGIN=$(cd "$HERE/../.." && pwd)
AO="$PLUGIN/bin/ao-topology"

ROOT=$(mktemp -d -t ao-nested-XXXXXX)
PASS=0
FAIL=0
SESSIONS=()

cleanup() {
  for session in "${SESSIONS[@]:-}"; do [ -n "$session" ] && tmux kill-session -t "$session" 2>/dev/null; done
  # Anything this run started but did not name, so a failure part-way does not leave panes behind.
  tmux ls 2>/dev/null | grep -E "^(nested-parent|nested-child|nested-fan)-" | cut -d: -f1 | while read -r s; do tmux kill-session -t "$s" 2>/dev/null; done
  rm -rf "$ROOT"
}
trap cleanup EXIT

ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "expected $3, got $2"; fi; }
jq_() { python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(eval(sys.argv[2]))" "$1" "$2" 2>/dev/null; }

echo "== fixture: a repo with a parent workflow and a child"
git init -q "$ROOT"
git -C "$ROOT" commit -q --allow-empty -m init
WF="$ROOT/.bytedesk/agent-orchestration/templates"
mkdir -p "$WF"
cat > "$WF/nested-child.json" <<'JSON'
{"name":"nested-child","description":"the team that is joined as a participant","agents":[
  {"id":"child-lead","role":"orchestrator","cli":"generic","command":"cat"},
  {"id":"child-hand","role":"worker","cli":"generic","command":"cat"}]}
JSON
cat > "$WF/nested-parent.json" <<'JSON'
{"name":"nested-parent","description":"a workflow with a workflow in it","agents":[
  {"id":"conductor","role":"orchestrator","cli":"generic","command":"cat"},
  {"id":"reviewers","workflow":"nested-child","inputs":{}}]}
JSON

echo
echo "== validate: a participant needs no cli, and may not claim one"
"$AO" validate --spec "$WF/nested-parent.json" --consumer "$ROOT" >/dev/null 2>&1
check "a spec whose participant has no cli is valid" "$?" "0"
python3 - "$WF" <<'PY'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1]) / "bad-participant.json"
spec = json.loads((pathlib.Path(sys.argv[1]) / "nested-parent.json").read_text())
spec["agents"][1]["cli"] = "claude"
p.write_text(json.dumps(spec))
PY
"$AO" validate --spec "$WF/bad-participant.json" --consumer "$ROOT" >/dev/null 2>&1
check "a participant that also names a cli is refused" "$?" "1"

echo
echo "== launch: the parent starts, and the child starts with it"
LAUNCH="$ROOT/launch.json"
"$AO" launch --template nested-parent --consumer "$ROOT" --json 2>/dev/null | sed -n '/^{/,$p' > "$LAUNCH"
PARENT_DIR=$(jq_ "$LAUNCH" "d['runDir']")
PARENT_SESSION=$(jq_ "$LAUNCH" "d['session']")
SESSIONS+=("$PARENT_SESSION")
check "the parent run reports running" "$(jq_ "$LAUNCH" "d['state']")" "running"

RUN="$PARENT_DIR/run.json"
CHILD_DIR=$(jq_ "$RUN" "[a for a in d['agents'] if a.get('workflow')][0]['workflow']['run_dir']")
CHILD_SESSION=$(jq_ "$RUN" "[a for a in d['agents'] if a.get('workflow')][0]['workflow']['session']")
CHILD_CONDUCTOR=$(jq_ "$RUN" "[a for a in d['agents'] if a.get('workflow')][0]['workflow']['conductor']")
SESSIONS+=("$CHILD_SESSION")
[ -n "$CHILD_DIR" ] && ok "the participant names a real child run" || no "the participant names a real child run" "run_dir was empty"
check "the child's conductor is recorded" "$CHILD_CONDUCTOR" "child-lead"

tmux has-session -t "$PARENT_SESSION" 2>/dev/null
check "the parent has its own tmux session" "$?" "0"
tmux has-session -t "$CHILD_SESSION" 2>/dev/null
check "the child has its own tmux session" "$?" "0"

echo
echo "== shape: a participant is a mailbox, not a pane"
check "the participant has no pane" "$(jq_ "$RUN" "[a for a in d['agents'] if a.get('workflow')][0]['pane']")" "None"
[ -d "$PARENT_DIR/agents/reviewers/inbox" ] && ok "the participant still has a mailbox" || no "the participant still has a mailbox"
[ ! -f "$PARENT_DIR/agents/reviewers/BOOTSTRAP.md" ] && ok "and no bootstrap — there is no process to brief" || no "and no bootstrap"
check "the parent's window holds only its own agents" "$(tmux list-panes -t "$PARENT_SESSION" 2>/dev/null | wc -l)" "1"

echo
echo "== lineage: the child knows where it came from"
CHILD_RUN="$CHILD_DIR/run.json"
check "the child records its depth" "$(jq_ "$CHILD_RUN" "d['depth']")" "1"
check "the child names the participant slot it fills" "$(jq_ "$CHILD_RUN" "d['parent']['agent_id']")" "reviewers"
check "the child names the workflow above it" "$(jq_ "$CHILD_RUN" "d['parent']['chain'][0]")" "nested-parent"
grep -q '"type":"run.spawned"' "$PARENT_DIR/journal.jsonl" 2>/dev/null
check "the parent journalled the spawn" "$?" "0"
[ -f "$PARENT_DIR/children.json" ] && ok "and indexed the child for stop to find" || no "and indexed the child for stop to find"

echo
echo "== addressing: the conductor talks to a team exactly like an agent"
SEND="$ROOT/send.json"
"$AO" send --run "$PARENT_DIR" --from conductor --to reviewers --stage brief --body "Review this. PING" --json 2>/dev/null | sed -n '/^{/,$p' > "$SEND"
check "the send is accepted" "$(jq_ "$SEND" "d['ok']")" "True"
check "and is forwarded into the child rather than rung at a pane" "$(jq_ "$SEND" "d['delivered'][0]['workflow']")" "nested-child"
[ -f "$CHILD_DIR/agents/child-lead/inbox/001-brief.md" ] && ok "it lands in the child conductor's inbox" || no "it lands in the child conductor's inbox"
grep -q "PING" "$CHILD_DIR/agents/child-lead/inbox/001-brief.md" 2>/dev/null
check "with the body intact" "$?" "0"

echo
echo "== answering: the child replies upward with only what its environment gave it"
LAUNCHER="$CHILD_DIR/agents/child-lead/launch-0.sh"
REPLY_DIR=$(grep -oE '^export AO_REPLY_TO_RUN_DIR=.*' "$LAUNCHER" | cut -d= -f2- | tr -d "'")
REPLY_AS=$(grep -oE '^export AO_REPLY_AS_AGENT=.*' "$LAUNCHER" | cut -d= -f2- | tr -d "'")
REPLY_TOKEN=$(grep -oE '^export AO_REPLY_TOKEN=.*' "$LAUNCHER" | cut -d= -f2- | tr -d "'")
check "the child conductor is told which slot it answers as" "$REPLY_AS" "reviewers"
check "and is pointed at the parent, not its own run" "$REPLY_DIR" "$PARENT_DIR"
# The child's own AO_AGENT_TOKEN is for ITS run; answering upward needs the parent's, which is why
# --token had to be wired. Without it this is the refusal the error text used to promise and not honour.
"$AO" reply --run "$REPLY_DIR" --agent "$REPLY_AS" --message 001-brief --body "unauthorized attempt" >/dev/null 2>&1
check "a reply upward with no token is refused" "$?" "1"
"$AO" reply --run "$REPLY_DIR" --agent "$REPLY_AS" --token "$REPLY_TOKEN" --message 001-brief --body "The team reviewed it. Verdict: ship." >/dev/null 2>&1
check "and is accepted with it" "$?" "0"

"$AO" wait --run "$PARENT_DIR" --from reviewers --message 001-brief --timeout 5s >/dev/null 2>&1
check "the parent's barrier releases on the team's answer" "$?" "0"

echo
echo "== refusals: a tree stays finite"
cat > "$WF/nested-selfish.json" <<'JSON'
{"name":"nested-selfish","description":"a workflow that contains itself","agents":[
  {"id":"conductor","role":"orchestrator","cli":"generic","command":"cat"},
  {"id":"again","workflow":"nested-selfish","inputs":{}}]}
JSON
# Refused at VALIDATION, which is earlier and better than refusing when the child fails: a spec
# naming itself is decidable without launching anything, so nothing should start. The indirect case
# (A contains B, B contains A) is only visible from the ancestry and is refused by the launcher with
# TOPOLOGY_WORKFLOW_CYCLE — this asserts the outcome rather than which of the two fired.
OUT=$("$AO" launch --template nested-selfish --consumer "$ROOT" --json 2>&1)
echo "$OUT" | grep -qE "TOPOLOGY_WORKFLOW_CYCLE|cannot contain itself"
check "a workflow that contains itself is refused" "$?" "0"
check "and nothing was started for it" "$(tmux ls 2>/dev/null | grep -cE '^nested-selfish-')" "0"

echo
echo "== fan-out: one entry, one child per item, addressed as a group"
cat > "$WF/nested-fan.json" <<'JSON'
{"name":"nested-fan","description":"one child per item","inputs":{"files":{"description":"which","default":"src/a.js,src/b.js"}},
 "agents":[
  {"id":"conductor","role":"orchestrator","cli":"generic","command":"cat"},
  {"id":"per-file","workflow":"nested-child","for_each":"{{inputs.files}}","inputs":{}}]}
JSON
FAN="$ROOT/fan.json"
"$AO" launch --template nested-fan --consumer "$ROOT" --json 2>/dev/null | sed -n '/^{/,$p' > "$FAN"
FAN_DIR=$(jq_ "$FAN" "d['runDir']")
FAN_SESSION=$(jq_ "$FAN" "d['session']")
SESSIONS+=("$FAN_SESSION")
check "one entry expanded into two children" "$(jq_ "$FAN_DIR/run.json" "len([a for a in d['agents'] if a.get('fanout_of')=='per-file'])")" "2"
# Ids come from the ITEM, not a position: the id is what a conductor types, and nobody can hold
# "per-file.1" in their head across a run.
check "and each is named after its item" "$(jq_ "$FAN_DIR/run.json" "sorted(a['id'] for a in d['agents'] if a.get('fanout_of'))[0]")" "per-file.src-a-js"
for s in $(jq_ "$FAN_DIR/run.json" "' '.join((a['workflow'] or {}).get('session','') for a in d['agents'] if a.get('fanout_of'))"); do SESSIONS+=("$s"); done

FANSEND="$ROOT/fansend.json"
"$AO" send --run "$FAN_DIR" --from conductor --to per-file --stage brief --body "fan me out" --json 2>/dev/null | sed -n '/^{/,$p' > "$FANSEND"
check "a send to the collective id reaches both members" "$(jq_ "$FANSEND" "len(d['delivered'])")" "2"
"$AO" wait --run "$FAN_DIR" --from per-file --timeout 3s >/dev/null 2>&1
check "and a barrier on the collective id waits for both" "$?" "2"

"$AO" stop --run "$FAN_DIR" >/dev/null 2>&1
check "stopping the fan-out takes every child with it" "$(tmux ls 2>/dev/null | grep -cE "^nested-child-")" "1"

echo
echo "== teardown: stopping the parent stops the tree"
STOP="$ROOT/stop.json"
"$AO" stop --run "$PARENT_DIR" 2>/dev/null | sed -n '/^{/,$p' > "$STOP"
check "stop reports the child it took with it" "$(jq_ "$STOP" "len(d['children_stopped'])")" "1"
tmux has-session -t "$CHILD_SESSION" 2>/dev/null
check "the child's session is gone" "$?" "1"
tmux has-session -t "$PARENT_SESSION" 2>/dev/null
check "and so is the parent's" "$?" "1"
grep -q '"type":"run.child_exited"' "$PARENT_DIR/journal.jsonl" 2>/dev/null
check "the parent journalled the child's exit" "$?" "0"

echo
echo "== summary"
echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
