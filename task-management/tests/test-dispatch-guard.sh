#!/usr/bin/env bash
# TM-360 — one duplicate-dispatch guard for the pool and a lead's start-worker.
#
#   1. the pool refuses a task agent-orchestration reports a live assignment or bound worker for;
#   2. a lead's start-worker (`tm dispatch <id> --backend tmux --json`, the argv
#      agent-orchestration's taskStore.dispatch runs) refuses a task the pool already dispatched;
#   3. `tm dispatch-check` gives the same answer, from the same function.
#
# agent-orchestration is a fake on TM_TOPOLOGY_BIN that records every argv it is given and answers
# from a reply file, so the test asserts WHICH call was made, not just that one was.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT HOME="$TM_ROOT/home" CLAUDE_PROJECT_DIR="$TM_ROOT" CLAUDE_CODE_SESSION_ID="test-session"
mkdir -p "$HOME"
unset TM_ENFORCE TM_SESSION_ID
export TM_DISPATCH_REGISTRY="$PLUGIN_ROOT/tests/unit/fixtures/fake-dispatch-registry.mjs"
NODE="$(node -p 'process.execPath')"
SELF="$PLUGIN_ROOT/bin/tm"
cleanup() { "$NODE" "$SELF" pool stop >/dev/null 2>&1 || true; rm -rf "$TM_ROOT"; }
trap cleanup EXIT
tm() { "$NODE" "$SELF" "$@"; }
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected: $2 | got: ${1:0:300}" ;; esac; }
ids() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log((JSON.parse(s)[process.argv[1]]||[]).map(d=>d.id).join(","))})' "$1"; }

echo "test-dispatch-guard"

# ── fake agent-orchestration ───────────────────────────────────────────────────
FAKE="$TM_ROOT/fake"
mkdir -p "$FAKE"
export AO_LOG="$TM_ROOT/ao.argv" AO_REPLY="$TM_ROOT/ao.reply"
cat > "$FAKE/ao-topology" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$AO_LOG"
cat "$AO_REPLY"
SH
chmod +x "$FAKE/ao-topology"
export TM_TOPOLOGY_BIN="$FAKE/ao-topology"

git init -q "$TM_ROOT"
git -C "$TM_ROOT" config user.email test@example.com
git -C "$TM_ROOT" config user.name Test
git -C "$TM_ROOT" config commit.gpgsign false
printf '# app\n' > "$TM_ROOT/README.md"
git -C "$TM_ROOT" add . && git -C "$TM_ROOT" commit -qm init

tm init >/dev/null
tm epic new "Guard" >/dev/null
T1="$(tm task new "Held by a lead" --body "context" --ac "it is not dispatched twice" | cut -d' ' -f1)"
tm label "$T1" ready-for-agent >/dev/null

# ── 1. pool: a worker the lead bound in agent-orchestration blocks the pickup ────────────
printf '{"assigned":false,"worker":{"kind":"tmux","backend":"tmux","run":"tmux:lead-worker"},"owner":"lead-1"}\n' > "$AO_REPLY"
: > "$AO_LOG"
ONCE="$(tm pool once --json)"
[[ -z "$(echo "$ONCE" | ids dispatched)" ]] && ok "pool does not dispatch a task with a live ao worker" || no "pool does not dispatch a task with a live ao worker" "$ONCE"
has "$ONCE" "live worker bound by its agent-orchestration lead" "the pool's skip names the ao worker"
has "$(cat "$AO_LOG")" "manage assignment --task $T1" "the pool asked ao about exactly this task"
[[ "$(tm show "$T1" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).status))')" == "open" ]] \
  && ok "the refused task is left open, unclaimed" || no "the refused task is left open, unclaimed"

# An unreleased idle-dispatch assignment is just as live.
printf '{"assigned":true,"pending":true,"agent_id":"agent-7"}\n' > "$AO_REPLY"
CHECK="$(tm dispatch-check "$T1" --json)"; RC=$?
[[ $RC -eq 2 ]] && ok "dispatch-check exits 2 for a live ao assignment" || no "dispatch-check exits 2 for a live ao assignment" "rc=$RC $CHECK"
has "$CHECK" '"source": "ao-assignment"' "dispatch-check names the ao assignment"

# ── 2. lead start-worker: a pool dispatch record blocks it ───────────────────────────────
printf '{"assigned":false,"reason":"no assignment"}\n' > "$AO_REPLY"
FREE="$(tm dispatch-check "$T1" --json)"; RC=$?
[[ $RC -eq 0 ]] && has "$FREE" '"free": true' "with nothing live anywhere the task is free" || no "with nothing live anywhere the task is free" "rc=$RC $FREE"
DISPATCHED="$(TM_SESSION_ID=pool-sess tm dispatch "$T1" --backend fake --json)"; RC=$?
[[ $RC -eq 0 ]] && ok "the pool-style dispatch goes through" || no "the pool-style dispatch goes through" "rc=$RC $DISPATCHED"
: > "$AO_LOG"
# Exactly the argv agent-orchestration's taskStore.dispatch runs for `manage start-worker`.
LEAD="$(TM_SESSION_ID=pool-sess tm dispatch "$T1" --backend tmux --json 2>&1)"; RC=$?
[[ $RC -eq 2 ]] && ok "start-worker's tm dispatch is refused (exit 2)" || no "start-worker's tm dispatch is refused (exit 2)" "rc=$RC $LEAD"
has "$LEAD" "is already dispatched to fake as fake:run-1" "the refusal names the pool's worker"
CHECK="$(tm dispatch-check "$T1" --json)"; RC=$?
[[ $RC -eq 2 ]] && has "$CHECK" '"source": "tm-dispatch"' "dispatch-check agrees: tm-dispatch holds it" || no "dispatch-check agrees" "rc=$RC $CHECK"

# ── 3. one function: both paths and the check verb resolve to liveOwner() ───────────────
CALLERS="$(grep -rn "liveOwner(" "$PLUGIN_ROOT/lib" "$PLUGIN_ROOT/bin/tm" | grep -v "export function" | sed "s|$PLUGIN_ROOT/||")"
has "$CALLERS" "lib/dispatch/index.mjs" "dispatch() (pool and start-worker) calls liveOwner"
has "$CALLERS" "bin/tm" "tm dispatch-check calls liveOwner"
if grep -q "task.dispatched && priorClaim" "$PLUGIN_ROOT/lib/dispatch/index.mjs"; then no "no second inline re-dispatch gate remains" "index.mjs still has its own"; else ok "no second inline re-dispatch gate remains"; fi

echo
echo "$PASS passed, $FAIL failed"
(( FAIL == 0 ))
