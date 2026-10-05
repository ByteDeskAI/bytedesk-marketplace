#!/usr/bin/env bash
# TM-397 — the Stop hook does not demand closing a task a live worker subagent of this session owns.
#
#   tm claim note <id> --worker <name> --ttl <n>   records the marker on this session's claim;
#   hooks/tm-hook.sh stop                          honours it while fresh, and blocks as before
#                                                  on a task with no live owner or an expired marker.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT HOME="$TM_ROOT/home" CLAUDE_PROJECT_DIR="$TM_ROOT" CLAUDE_CODE_SESSION_ID="lead-session"
mkdir -p "$HOME"
unset TM_ENFORCE TM_SESSION_ID
trap 'rm -rf "$TM_ROOT"' EXIT
NODE="$(node -p 'process.execPath')"
tm() { "$NODE" "$PLUGIN_ROOT/bin/tm" "$@"; }
hook() { echo '{"session_id":"lead-session"}' | "$PLUGIN_ROOT/hooks/tm-hook.sh" stop 2>/dev/null; }
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected: $2 | got: ${1:0:300}" ;; esac; }
lacks() { case "$1" in *"$2"*) no "$3" "unexpected: $2 | got: ${1:0:300}" ;; *) ok "$3" ;; esac; }

echo "test-claim-note"
tm init >/dev/null
tm epic new "Workers" >/dev/null
W="$(tm task new "Handed to a worker subagent" --body "context" --ac "done" | cut -d' ' -f1)"
L="$(tm task new "Nobody is on it" --body "context" --ac "done" | cut -d' ' -f1)"
tm start "$W" >/dev/null
tm start "$L" >/dev/null

# ── the marker is this session's to write ──────────────────────────────────────────────
OUT="$(tm claim note "$W" --worker w-guard --ttl 60m)"; RC=$?
[[ $RC -eq 0 ]] && has "$OUT" "worker w-guard noted until" "claim note records the worker on this session's claim" || no "claim note records the worker" "rc=$RC $OUT"
OTHER="$(CLAUDE_CODE_SESSION_ID=someone-else tm claim note "$L" --worker x 2>&1)"; RC=$?
[[ $RC -eq 2 ]] && has "$OTHER" "is not claimed by this session" "another session cannot mark this session's claim" || no "another session cannot mark" "rc=$RC $OTHER"

# ── stop: the worker's task is exempt, the unowned one still blocks ────────────────────
STOP="$(hook)"
has "$STOP" '"decision":"block"' "stop still blocks while an unowned task is in progress"
has "$STOP" "$L" "the unowned task is named"
lacks "$STOP" "$W" "the task with a live worker is not named"
has "$STOP" "tm claim note <id> --worker <name>" "the refusal names the marker verb"

# Close the unowned one: now only the worker's task is in progress, and stop goes through.
tm park "$L" >/dev/null 2>&1 || tm block "$L" "test" >/dev/null
[[ -z "$(hook)" ]] && ok "with only a live-worker task in progress, stop does not block" || no "with only a live-worker task in progress, stop does not block" "$(hook)"

# ── an expired marker exempts nothing ───────────────────────────────────────────────────
tm claim note "$W" --worker w-guard --ttl 0s >/dev/null
STOP="$(hook)"
has "$STOP" '"decision":"block"' "an expired marker blocks as today"
has "$STOP" "$W" "and names the task"

echo
echo "$PASS passed, $FAIL failed"
(( FAIL == 0 ))
