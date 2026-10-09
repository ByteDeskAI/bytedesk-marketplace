#!/usr/bin/env bash
# TM-379 (EP-028): `tm doctor --all` is the combined doctor from task-management's side.
# With agent-orchestration present it runs AO's `agent-orchestration doctor` (which checks AO, this
# store and the services) and keeps its exit status; without AO it checks this store and says what
# it could not check. agent-orchestration is a fake that records its argv; nothing real runs.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
R="$TMP/repo"
AO_LOG="$TMP/ao.log"
mkdir -p "$TMP/home" "$R" "$TMP/ao/bin"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home" TM_PLUGIN_ROOT="$PLUGIN_ROOT" CLAUDE_CODE_SESSION_ID="test-doctor-all" TM_NTFY_OFF=1
unset CLAUDE_PROJECT_DIR TM_ENFORCE

printf '#!/usr/bin/env bash\n' > "$TMP/ao/bin/ao-topology"
cat > "$TMP/ao/bin/agent-orchestration" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$AO_LOG"
echo '{"combined":{"ok":false}}'
exit 1
EOF
chmod +x "$TMP/ao/bin/ao-topology" "$TMP/ao/bin/agent-orchestration"

tm() { (cd "$R" && TM_ROOT="$R" node "$PLUGIN_ROOT/bin/tm" "$@"); }
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected: $2 | got: ${1:0:300}" ;; esac; }

echo "test-doctor-all"
tm init >/dev/null

# ── AO absent: this store alone, and it says what it did not check ──────────
out="$(TM_TOPOLOGY_BIN="" tm doctor --all)"; code=$?
[[ $code -eq 0 ]] && ok "without AO, a clean store exits 0" || no "without AO, a clean store exits 0" "exit $code"
has "$out" "agent-orchestration is not installed" "without AO, --all says AO and services were not checked"
out="$(TM_TOPOLOGY_BIN="" tm doctor --all --json)"
has "$out" '"present": false' "without AO, --json reports agentOrchestration.present false"

# ── AO present: its combined doctor runs, and its exit status is tm's ───────
out="$(TM_TOPOLOGY_BIN="$TMP/ao/bin/ao-topology" tm doctor --all)"; code=$?
[[ $code -eq 1 ]] && ok "with AO, --all keeps the combined doctor's exit status" || no "with AO, --all keeps the combined doctor's exit status" "exit $code"
has "$out" '"combined"' "with AO, --all prints the combined report"
has "$(cat "$AO_LOG" 2>/dev/null)" "doctor --consumer-cwd $R" "with AO, --all runs agent-orchestration doctor for this repository"

# ── without --all nothing calls AO ──────────────────────────────────────────
: > "$AO_LOG"
TM_TOPOLOGY_BIN="$TMP/ao/bin/ao-topology" tm doctor >/dev/null; code=$?
[[ $code -eq 0 && ! -s "$AO_LOG" ]] && ok "plain tm doctor never runs AO" || no "plain tm doctor never runs AO" "exit $code, log: $(cat "$AO_LOG")"

echo "  $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
