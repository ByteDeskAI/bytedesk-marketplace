#!/usr/bin/env bash
# Two real repositories, two agent rosters, one cross-repo conversation.
#
# This is the acceptance harness for EP-014: everything the epic added — the agent library, minted
# identity, the resource-path convention, cross-repo routing, delegation, the mailbox barrier — is
# exercised the way a consumer would use it, through the CLI, against real git repos on disk.
#
# It needs tmux and node. It does NOT need a model: agents launch on the `generic` adapter running
# `cat`, which is an interactive process that sits in a pane exactly like a CLI would. What is under
# test is the orchestration layer, not the agent.
#
#   bash tests/live/two-projects.sh                 # throwaway repos under a temp dir
#   bash tests/live/two-projects.sh /path/to/root   # reuse an existing project-1/project-2 pair
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PLUGIN=$(cd "$HERE/../.." && pwd)
AO="$PLUGIN/bin/ao-topology"

# A root passed on the command line belongs to the caller and is never removed. One we made
# ourselves is scratch, and a harness that leaves a directory behind on every run is a harness
# nobody runs twice.
if [ $# -ge 1 ]; then
  ROOT=$1
  OWN_ROOT=""
else
  ROOT=$(mktemp -d -t ao-two-projects-XXXXXX)
  OWN_ROOT=$ROOT
fi
P1="$ROOT/project-1"
P2="$ROOT/project-2"

cleanup() {
  # Kill the session first: removing the run directory out from under a live pane leaves the pane
  # alive with nowhere to write.
  [ -n "${SESSION:-}" ] && tmux kill-session -t "$SESSION" 2>/dev/null
  [ -n "$OWN_ROOT" ] && rm -rf "$OWN_ROOT"
  return 0
}
trap cleanup EXIT INT TERM

pass=0
fail=0

ok()   { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad()  { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; [ $# -gt 1 ] && printf '       %s\n' "$2"; }
step() { printf '\n== %s\n' "$1"; }

# assert_contains <label> <haystack> <needle>
assert_contains() {
  case "$2" in
    *"$3"*) ok "$1" ;;
    *) bad "$1" "expected to find: $3
       in: $(printf '%s' "$2" | head -c 400)" ;;
  esac
}

# assert_fails <label> <needle-in-error> <command...>
assert_fails() {
  local label=$1 needle=$2; shift 2
  local out rc
  out=$("$@" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then
    bad "$label" "command succeeded but should have failed: $*"
  else
    assert_contains "$label" "$out" "$needle"
  fi
}

# Pull one field out of a CLI JSON response. A command that failed prints an error line, not JSON;
# that is a normal outcome here (several cases assert on failure), so it yields empty rather than a
# stack trace that buries the assertion that follows.
json() { node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    try {
      const start=s.indexOf("{");
      const v=JSON.parse(start>=0?s.slice(start):s);
      let cur=v; for(const k of process.argv[1].split(".").filter(Boolean)) cur=cur?.[k];
      process.stdout.write(cur===undefined?"":String(cur));
    } catch { process.stdout.write(""); }
  });' "$1"; }

step "fixture: two repositories under $ROOT"
for dir in "$P1" "$P2"; do
  mkdir -p "$dir"
  if [ ! -d "$dir/.git" ]; then
    git -C "$dir" init -q
    printf '# %s\n' "$(basename "$dir")" > "$dir/README.md"
  fi
done
# Start from a clean roster so the run is repeatable against a reused root.
rm -rf "$P1/.bytedesk/agent-orchestration" "$P2/.bytedesk/agent-orchestration"
ok "project-1 and project-2 exist as git repos"

step "roster: each repo gets its own agents, minted with identity"
P1_LEAD=$("$AO" agent new --consumer "$P1" --role lead --cli claude | json .id)
P1_IMPL=$("$AO" agent new --consumer "$P1" --role implementer --cli claude | json .id)
P1_REV=$("$AO" agent new --consumer "$P1" --role reviewer --cli claude | json .id)
P2_LEAD=$("$AO" agent new --consumer "$P2" --role lead --cli claude | json .id)
P2_RES=$("$AO" agent new --consumer "$P2" --role researcher --cli claude | json .id)

for id in "$P1_LEAD" "$P1_IMPL" "$P1_REV" "$P2_LEAD" "$P2_RES"; do
  case "$id" in
    ????????) ;;
    *) bad "minted id is a stable short id" "got '$id'" ;;
  esac
done
[ -n "$P1_LEAD" ] && [ -n "$P2_RES" ] && ok "five agents minted across two repos"

# The id is the address; a person sees the name and title.
roster=$("$AO" agent list --consumer "$P1")
assert_contains "roster shows names and titles, not bare ids" "$roster" "Engineering Lead"

# An agent's record lives under the new resource-path convention, beside its sibling resource types.
[ -f "$P1/.bytedesk/agent-orchestration/agents/$P1_LEAD/agent.json" ] \
  && ok "agents are stored under .bytedesk/agent-orchestration/" \
  || bad "agents are stored under .bytedesk/agent-orchestration/" "missing agent.json for $P1_LEAD"

step "hierarchy: exactly one lead per repo"
assert_fails "a second lead in the same repo is refused" "lead" \
  "$AO" agent new --consumer "$P1" --role lead --cli claude

step "identity: an agent resolves by id and by full name"
full=$("$AO" agent show "$P1_IMPL" --consumer "$P1" | json .full_name)
displayed=$("$AO" agent show "$P1_IMPL" --consumer "$P1" | json .agent)
by_name=$("$AO" agent show "$full" --consumer "$P1" | json .id)
[ "$by_name" = "$P1_IMPL" ] \
  && ok "resolving by full name reaches the same agent as the id" \
  || bad "resolving by full name reaches the same agent as the id" "'$full' -> '$by_name' != '$P1_IMPL'"

# The CLI prints "Name, Title"; pasting back what it printed has to work, or the display form is a
# dead end for the operator.
by_display=$("$AO" agent show "$displayed" --consumer "$P1" | json .id)
[ "$by_display" = "$P1_IMPL" ] \
  && ok "resolving by the displayed 'Name, Title' form works" \
  || bad "resolving by the displayed 'Name, Title' form works" "'$displayed' -> '$by_display'"

step "safety: a spec may not launch outside the repo that invoked it"
cat > "$ROOT/escape.json" <<JSON
{ "version": 1, "name": "escape-probe", "cwd": "/tmp",
  "agents": [{ "id": "boss", "role": "orchestrator", "cli": "claude" }],
  "workflow": [{ "stage": "go", "from": "boss", "to": ["boss"] }] }
JSON
assert_fails "a cwd outside the repo is refused" "TOPOLOGY_PATH_ESCAPES_REPO" \
  "$AO" launch --spec "$ROOT/escape.json" --consumer "$P1" --dry-run
escaped=$("$AO" launch --spec "$ROOT/escape.json" --consumer "$P1" --dry-run --allow-outside 2>&1)
assert_contains "--allow-outside is a real escape hatch, not a dead flag" "$escaped" '"cwd": "/tmp"'

step "safety: auto_approve needs explicit operator consent"
cat > "$ROOT/yolo.json" <<JSON
{ "version": 1, "name": "yolo-probe",
  "agents": [{ "id": "boss", "role": "orchestrator", "cli": "claude", "auto_approve": true }],
  "workflow": [{ "stage": "go", "from": "boss", "to": ["boss"] }] }
JSON
assert_fails "auto_approve without consent refuses to launch" "auto_approve" \
  "$AO" launch --spec "$ROOT/yolo.json" --consumer "$P1" --dry-run
consented=$("$AO" launch --spec "$ROOT/yolo.json" --consumer "$P1" --dry-run --allow-auto-approve 2>&1)
assert_contains "consented auto_approve launches and says which agents are affected" "$consented" "boss"

step "launch: a real tmux run in project-1, on a fake agent CLI"
# A test double rather than a model: what is under test is the orchestration layer, not the agent.
# It prints a ready line and then sits on stdin exactly as an interactive CLI does.
mkdir -p "$ROOT/providers"
cat > "$ROOT/providers/fake.json" <<'JSON'
{
  "id": "fake",
  "display": "Fake agent",
  "command": "sh",
  "args": ["-c", "printf 'fake-agent ready\\n'; exec cat"],
  "model_args": [],
  "system_prompt_args": [],
  "auto_approve_args": [],
  "add_dir_args": ["--add-dir", "{{dir}}"],
  "coordinator_args": ["--no-write-tools"],
  "ready": { "pattern": "fake-agent ready", "delay_ms": 500, "timeout_ms": 20000 },
  "submit_keys": ["Enter"],
  "bootstrap_message": "Read {{bootstrap_file}} and follow it.",
  "detect": null,
  "install_hint": "test double; never installed",
  "notes": "Test double used by tests/live/two-projects.sh."
}
JSON

cat > "$ROOT/team.json" <<JSON
{ "version": 1, "name": "p1-team",
  "description": "project-1's own roster, launched by minted id so routing can find the lead.",
  "agents": [
    { "agent": "$P1_LEAD", "id": "$P1_LEAD", "role": "orchestrator", "cli": "fake" },
    { "agent": "$P1_IMPL", "id": "$P1_IMPL", "role": "implementer",  "cli": "fake" },
    { "agent": "$P1_REV",  "id": "$P1_REV",  "role": "reviewer",     "cli": "fake" }
  ],
  "workflow": [ { "stage": "brief", "from": "$P1_LEAD", "to": ["$P1_IMPL"] } ] }
JSON

launched=$("$AO" launch --spec "$ROOT/team.json" --consumer "$P1" --providers-dir "$ROOT/providers" --json 2>&1)
RUN_DIR=$(printf '%s' "$launched" | json .runDir)
SESSION=$(printf '%s' "$launched" | json .session)
if [ -n "$RUN_DIR" ] && [ -f "$RUN_DIR/run.json" ]; then
  ok "a run was created under the repo"
else
  bad "a run was created under the repo" "$(printf '%s' "$launched" | head -c 500)"
fi
# Guard the empty case: `tmux has-session -t ""` is not a failure, so an unset SESSION would
# otherwise read as a pass.
if [ -n "$SESSION" ] && tmux has-session -t "$SESSION" 2>/dev/null; then
  ok "the tmux session is live"
else
  bad "the tmux session is live" "no session ${SESSION:-<none>}"
fi

# Run artifacts must not land in the consumer's history: .bytedesk/ is a tree these repos commit.
[ -f "$P1/.bytedesk/agent-orchestration/runs/.gitignore" ] \
  && ok "the runs directory ignores itself" \
  || bad "the runs directory ignores itself" "no .gitignore under runs/"
untracked=$(git -C "$P1" status --porcelain --untracked-files=all | grep -c "agent-orchestration/runs/" || true)
[ "$untracked" = "0" ] \
  && ok "no run artifact shows up as untracked in the consumer" \
  || bad "no run artifact shows up as untracked in the consumer" "$untracked paths"

step "memory: a library agent works from its own directory, granted the repo"
# Claude keys memory by working directory, so a shared cwd means a shared memory. Each library
# agent therefore gets its own, and the repo it actually works in is granted through the adapter's
# own add-dir mechanism rather than a hardcoded flag.
impl_cwd=$(node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    try {
      const r=JSON.parse(s.slice(s.indexOf("{")));
      const a=(r.agents||[]).find(x=>x.id===process.argv[1]);
      process.stdout.write(a?String(a.cwd||""):"");
    } catch { process.stdout.write(""); }
  });' "$P1_IMPL" < "$RUN_DIR/run.json")
case "$impl_cwd" in
  */.bytedesk/agent-orchestration/agents/"$P1_IMPL"*) ok "a library agent runs from its own directory" ;;
  *) bad "a library agent runs from its own directory" "cwd=$impl_cwd" ;;
esac
lead_cwd=$(node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    try {
      const r=JSON.parse(s.slice(s.indexOf("{")));
      const a=(r.agents||[]).find(x=>x.id===process.argv[1]);
      process.stdout.write(a?String(a.cwd||""):"");
    } catch { process.stdout.write(""); }
  });' "$P1_LEAD" < "$RUN_DIR/run.json")
[ -n "$impl_cwd" ] && [ "$impl_cwd" != "$lead_cwd" ] \
  && ok "two agents in the same repo do not share a working directory" \
  || bad "two agents in the same repo do not share a working directory" "both at $impl_cwd"
[ -d "$impl_cwd" ] \
  && ok "the agent directory exists before the launcher cds into it" \
  || bad "the agent directory exists before the launcher cds into it" "$impl_cwd missing"

# cwd scopes identity and memory; --add-dir is what grants access to the tree it actually works in.
# Without the grant the mapping would be prose in a prompt and the agent would be denied the repo.
granted=$(grep -ho -- "--add-dir '\?[^ ']*" "$RUN_DIR/agents/$P1_IMPL"/launch-*.sh 2>/dev/null | head -1)
case "$granted" in
  *"$P1"*) ok "the repo is granted through the adapter's own add-dir mechanism" ;;
  *) bad "the repo is granted through the adapter's own add-dir mechanism" "got: ${granted:-<nothing>}" ;;
esac

# The lead is the only address an outsider may reach directly, so it is the most exposed agent in
# the system and should be the least capable. "Cannot write the repo" has to be a property of what
# it was launched with, not a sentence in its prompt.
lead_launcher=$(ls "$RUN_DIR/agents/$P1_LEAD"/launch-*.sh 2>/dev/null | head -1)
if grep -q -- "--add-dir" "$lead_launcher" 2>/dev/null; then
  bad "a coordinator is granted no directory beyond its own" "$(grep -ho -- '--add-dir [^ ]*' "$lead_launcher" | head -1)"
else
  ok "a coordinator is granted no directory beyond its own"
fi
grep -q -- "--no-write-tools" "$lead_launcher" 2>/dev/null \
  && ok "a coordinator's write tools are removed by its adapter, not by its prompt" \
  || bad "a coordinator's write tools are removed by its adapter, not by its prompt"
grep -q -- "--no-write-tools" "$RUN_DIR/agents/$P1_IMPL"/launch-*.sh 2>/dev/null \
  && bad "a worker keeps its write tools" "implementer was launched as a coordinator" \
  || ok "a worker keeps its write tools"

step "collaboration: inside one project, agents reach each other directly"
sent=$("$AO" send --run "$RUN_DIR" --from "$P1_LEAD" --to "$P1_IMPL" --stage brief \
       --body "Please summarise README.md." --no-ring 2>&1)
MSG=$(printf '%s' "$sent" | json .id)
[ -n "$MSG" ] && ok "a message was delivered internally with no redirect" \
              || bad "a message was delivered internally with no redirect" "$(printf '%s' "$sent" | head -c 300)"
redirected=$(printf '%s' "$sent" | json .redirected)
[ -z "$redirected" ] && ok "an internal message is not redirected" \
                     || bad "an internal message is not redirected" "redirected=$redirected"

step "authentication: an agent may only write its own outbox"
# The token the agent's own launcher exported is the identity; --agent alone is not a claim.
# Read the secret from the agent's OWN launcher, which is the only place it legitimately lives.
# run.json keeps a digest, not the token: the run dir is readable by anything running as this user,
# so a record holding the secret is enough to forge with, while a digest is only enough to check
# with. Reading it back out of run.json here would have quietly required that weaker shape.
TOKEN=$(grep -ho 'AO_AGENT_TOKEN=[^ ]*' "$RUN_DIR/agents/$P1_IMPL"/launch-*.sh 2>/dev/null \
        | head -1 | cut -d= -f2 | tr -d "'\"")
if [ -n "$TOKEN" ]; then
  assert_fails "another agent cannot answer on this agent's behalf" "TOPOLOGY_AGENT_UNAUTHORIZED" \
    env AO_AGENT_TOKEN=not-the-token "$AO" reply --run "$RUN_DIR" --agent "$P1_IMPL" --message "$MSG" --body "forged"
  assert_fails "an empty reply satisfies nothing" "TOPOLOGY_REPLY_EMPTY" \
    env AO_AGENT_TOKEN="$TOKEN" "$AO" reply --run "$RUN_DIR" --agent "$P1_IMPL" --message "$MSG" --body "   "
  env AO_AGENT_TOKEN="$TOKEN" "$AO" reply --run "$RUN_DIR" --agent "$P1_IMPL" --message "$MSG" \
      --body "README.md is one heading." >/dev/null 2>&1 \
    && ok "the real agent, holding its own token, can answer" \
    || bad "the real agent, holding its own token, can answer"
  waited=$("$AO" wait --run "$RUN_DIR" --from "$P1_IMPL" --message "$MSG" --timeout 20s --json 2>&1)
  assert_contains "the barrier is satisfied by that answer" "$waited" "README.md is one heading."
else
  bad "per-agent tokens are minted at launch" "no token on $P1_IMPL in run.json — recordReply's identity check is inert without one"
fi

step "cross-repo: an outsider reaches the lead, not the member"
OUT=$("$AO" send --run "$RUN_DIR" --from "$P2_RES" --from-project "$P2" --to "$P1_IMPL" \
      --stage question --body "Can you review our adapter?" --task TM-999 --no-ring 2>&1)
assert_contains "an unvouched outsider is redirected" "$OUT" "$P1_LEAD"
OUTMSG=$(printf '%s' "$OUT" | json .id)
[ -f "$RUN_DIR/agents/$P1_LEAD/inbox/$OUTMSG.md" ] \
  && ok "the redirected message landed in the lead's inbox" \
  || bad "the redirected message landed in the lead's inbox"
grep -q "intended_for" "$RUN_DIR/agents/$P1_LEAD/inbox/$OUTMSG.md" 2>/dev/null \
  && ok "the envelope preserves the original addressee" \
  || bad "the envelope preserves the original addressee"
grep -q "route.redirect" "$RUN_DIR/journal.jsonl" 2>/dev/null \
  && ok "the redirect is journalled, not silent" \
  || bad "the redirect is journalled, not silent"

step "observability: the lead's inbox depth is a number, not a feeling"
# The lead is a bottleneck by design — every unvouched cross-repo contact lands on it — and
# congestion there raises no error, it just makes everyone slower.
depth=$("$AO" status --run "$RUN_DIR" --json 2>&1 | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    try {
      const r=JSON.parse(s.slice(s.indexOf("{")));
      const q=(r.queues||[]).find(x=>x.agent===process.argv[1]);
      process.stdout.write(String(q?q.depth:0));
    } catch { process.stdout.write("0"); }
  });' "$P1_LEAD")
[ "${depth:-0}" -ge 1 ] \
  && ok "the redirected message shows up as queue depth on the lead" \
  || bad "the redirected message shows up as queue depth on the lead" "depth=$depth"

# The via chain is what stops a message being re-forwarded around a ring of leads forever. It only
# works if a forwarding sender actually passes the chain on, so the CLI has to carry it.
long_via="a,b,c,d,e"
assert_fails "a message that has already taken too many hops is refused" "TOPOLOGY_HOP_LIMIT" \
  "$AO" send --run "$RUN_DIR" --from "$P2_RES" --from-project "$P2" --to "$P1_LEAD" \
       --stage question --via "$long_via" --body "Round and round." --no-ring

step "delegation: a token is a pointer, the receiving repo's store is the permission"
# No task-management store in project-1 yet, so nothing here vouches for a delegation.
assert_fails "a delegation with nothing backing it is refused at issue time" "TOPOLOGY_DELEGATION_UNBACKED" \
  "$AO" delegate --consumer "$P1" --task TM-500 --to "$P1_IMPL" --for "$P2_RES"

# Give project-1 a real (minimal) store holding TM-500, assigned to the implementer.
mkdir -p "$P1/.bytedesk/task-management/tasks"
cat > "$P1/.bytedesk/task-management/tasks/TM-500-review-the-adapter.md" <<MD
---
id: "TM-500"
title: "Review the adapter"
status: "open"
assignee: "$P1_IMPL"
---

Coordinate with project-2 on the adapter.
MD

issued=$("$AO" delegate --consumer "$P1" --task TM-500 --to "$P1_IMPL" --for "$P2_RES" 2>&1)
DTOKEN=$(printf '%s' "$issued" | json .token)
[ -n "$DTOKEN" ] \
  && ok "the same delegation is issued once the store backs it" \
  || bad "the same delegation is issued once the store backs it" "$(printf '%s' "$issued" | head -c 300)"

direct=$("$AO" send --run "$RUN_DIR" --from "$P2_RES" --from-project "$P2" --to "$P1_IMPL" \
         --stage question --task TM-500 --token "$DTOKEN" \
         --body "Following up on TM-500." --no-ring 2>&1)
assert_contains "the delegated outsider now reaches the member directly" "$direct" '"redirected": false'

# A coordinator is not a worker: that has to be refused mechanically, not described in a prompt.
assert_fails "work cannot be delegated to a coordinates_only agent" "TOPOLOGY_COORDINATOR_NOT_A_WORKER" \
  "$AO" delegate --consumer "$P1" --task TM-500 --to "$P1_LEAD" --for "$P2_RES"

# Close the task in the store and the same token stops authorising anything, with no revocation step.
sed -i 's/^status: "open"$/status: "done"/' "$P1/.bytedesk/task-management/tasks/TM-500-review-the-adapter.md"
after=$("$AO" send --run "$RUN_DIR" --from "$P2_RES" --from-project "$P2" --to "$P1_IMPL" \
        --stage question --task TM-500 --token "$DTOKEN" \
        --body "One more thing." --no-ring 2>&1)
assert_contains "closing the task in the store revokes the delegation" "$after" "$P1_LEAD"

step "teardown"
if [ -n "$RUN_DIR" ]; then
  "$AO" stop --run "$RUN_DIR" >/dev/null 2>&1
fi
if [ -n "$SESSION" ] && tmux has-session -t "$SESSION" 2>/dev/null; then
  bad "stop tears the session down" "session $SESSION still alive"
  tmux kill-session -t "$SESSION" 2>/dev/null || true
else
  ok "stop tears the session down"
fi

step "summary"
printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || {
  # Keep the evidence when something failed — that is exactly when the run directory is worth
  # reading. Say where it is, since the caller was expecting it to be cleaned up.
  [ -n "$OWN_ROOT" ] && { OWN_ROOT=""; printf 'kept for inspection: %s\n' "$ROOT"; }
  exit 1
}
# Do not print a scratch path that is about to be deleted — it reads as somewhere to go and look.
if [ -n "$OWN_ROOT" ]; then
  printf 'scratch repositories removed\n'
else
  printf 'root: %s\n' "$ROOT"
fi
