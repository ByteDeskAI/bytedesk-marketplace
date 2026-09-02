#!/usr/bin/env bash
# TM-065 — the `tm pool` verb contract: help registration, `once --json` against a
# temp store (via the fake dispatch registry), the --auto opt-in off-ramp, and the
# start/status/stop/second-start-refusal lifecycle around pool.pid.
#
# A real git repo, because `once` really dispatches and dispatch provisions a
# worktree. The backend is the fake registry — no worker ever launches.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT
# The name Claude Code actually sets — see test-events.sh.
export CLAUDE_CODE_SESSION_ID="test-session"
unset TM_ENFORCE
# The one mechanism that reaches the CLI subprocess and the detached pool child.
export TM_DISPATCH_REGISTRY="$PLUGIN_ROOT/tests/unit/fixtures/fake-dispatch-registry.mjs"
# The real node binary: `pool stop` signals the child, and a shim would swallow that.
NODE="$(node -p 'process.execPath')"
SELF="$PLUGIN_ROOT/bin/tm"
cleanup() {
  "$NODE" "$SELF" pool stop >/dev/null 2>&1 || true
  rm -rf "$TM_ROOT"
}
trap cleanup EXIT

tm() { "$NODE" "$SELF" "$@"; }
STORE="$TM_ROOT/.bytedesk/task-management"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected: $2 | got: ${1:0:200}" ;; esac; }
# One field out of a --json payload.
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s)[process.argv[1]])})' "$1"; }
wait_file() { for _ in $(seq 1 40); do [[ -e "$1" ]] && return 0; sleep 0.25; done; return 1; }
wait_gone() { for _ in $(seq 1 40); do [[ ! -e "$1" ]] && return 0; sleep 0.25; done; return 1; }

echo "test-pool"

# Real git: the pool's dispatch provisions a worktree.
git init -q "$TM_ROOT"
git -C "$TM_ROOT" config user.email test@example.com
git -C "$TM_ROOT" config user.name Test
git -C "$TM_ROOT" config commit.gpgsign false
printf '# app\n' > "$TM_ROOT/README.md"
git -C "$TM_ROOT" add . && git -C "$TM_ROOT" commit -qm init

tm init >/dev/null
tm epic new "Pool" >/dev/null
T1="$(tm task new "Poolable work" --body "context" --ac "it dispatches" | cut -d' ' -f1)"
tm label "$T1" ready-for-agent >/dev/null
tm task new "Not for agents" --body "context" --ac "it stays put" >/dev/null

# ── help registration ────────────────────────────────────────────────────────
has "$(tm help)" "pool [once|start|stop|status]" "help lists the pool verb"
hasnt_run="$(tm help)"
case "$hasnt_run" in *"pool run"*) no "help hides the internal run action" "found 'pool run'" ;; *) ok "help hides the internal run action" ;; esac

# ── once: one tick, the ready task dispatches, the unlabeled one does not ────
ONCE="$(tm pool once --json)"
[[ "$(echo "$ONCE" | jget disabled 2>/dev/null)" == "undefined" ]] && ok "once is not disabled by default" || no "once is not disabled by default" "$ONCE"
DID="$(echo "$ONCE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log((r.dispatched||[]).map(d=>d.id).join(","))})')"
[[ "$DID" == "$T1" ]] && ok "once dispatches the ready-for-agent task" || no "once dispatches the ready-for-agent task" "$ONCE"
[[ "$(tm show "$T1" --json | jget status)" == "in_progress" ]] && ok "the dispatched task is in_progress" || no "the dispatched task is in_progress"

# A second tick: the task is claimed now, so nothing dispatches again.
AGAIN="$(tm pool once --json)"
[[ "$(echo "$AGAIN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).dispatched.length)})')" == "0" ]] \
  && ok "a claimed task is not re-dispatched" || no "a claimed task is not re-dispatched" "$AGAIN"

# ── kill-switch: TM_ENFORCE=off disables the tick ────────────────────────────
OFF="$(TM_ENFORCE=off tm pool once --json)"
[[ "$(echo "$OFF" | jget disabled)" == "true" ]] && ok "TM_ENFORCE=off disables the tick" || no "TM_ENFORCE=off disables the tick" "$OFF"

# ── the monitor's off-ramp: --auto exits 0 unless dispatch.enabled ───────────
AUTO_OUT="$(tm pool run --auto 2>&1)" && ok "pool run --auto exits 0 when not enabled" || no "pool run --auto exits 0 when not enabled"
has "$AUTO_OUT" "opt-in" "the off-ramp says why"
[[ ! -e "$STORE/pool.pid" ]] && ok "a refused autostart leaves no pid file" || no "a refused autostart leaves no pid file"

# ── status before a pool exists ──────────────────────────────────────────────
[[ "$(tm pool status --json | jget running)" == "false" ]] && ok "status reports no pool" || no "status reports no pool"

# ── start / status / second-start refusal / stop ─────────────────────────────
START_OUT="$(tm pool start)" || no "pool start succeeds" "$START_OUT"
has "$START_OUT" "pool started" "pool start reports the child pid"
wait_file "$STORE/pool.pid" && ok "the child wrote pool.pid" || no "the child wrote pool.pid"
[[ "$(tm pool status --json | jget running)" == "true" ]] && ok "status sees the running pool" || no "status sees the running pool" "$(tm pool status --json)"

tm pool start >/dev/null 2>"$TM_ROOT/second.err"
[[ "$?" == "2" ]] && ok "a second start is refused with exit 2" || no "a second start is refused with exit 2"
has "$(cat "$TM_ROOT/second.err")" "already running" "the refusal names the incumbent"

tm pool stop >/dev/null && ok "pool stop succeeds" || no "pool stop succeeds"
wait_gone "$STORE/pool.pid" && ok "the child removed pool.pid on SIGTERM" || no "the child removed pool.pid on SIGTERM"
[[ "$(tm pool status --json | jget running)" == "false" ]] && ok "status reports the pool stopped" || no "status reports the pool stopped"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
