#!/usr/bin/env bash
# TM-362 — `tm claim renew --live` renews a live worker's claim after the dispatching process is
# gone, and leaves a dead worker's claim alone. Exercised through the real CLI and the real tmux
# collector, against a temp store.
#
# tmux is a SHIM on PATH, never a real server: `has-session -t tm-live` answers 0 (alive), every
# other call answers 1 (gone), and each call is appended to a log so the test can show the
# collector actually asked. TMUX is blanked and TMUX_TMPDIR is per-test regardless, so even a
# mistaken real tmux could not reach the operator's server.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT CLAUDE_PROJECT_DIR="$TM_ROOT" CLAUDE_CODE_SESSION_ID="test-session"
export HOME="$TM_ROOT/home" TMUX="" TMUX_TMPDIR="$TM_ROOT/tmux"
mkdir -p "$HOME" "$TMUX_TMPDIR" "$TM_ROOT/bin"
unset TM_ENFORCE
trap 'rm -rf "$TM_ROOT"' EXIT

cat >"$TM_ROOT/bin/tmux" <<EOF
#!/usr/bin/env bash
echo "\$*" >>"$TM_ROOT/tmux.calls"
[[ "\$1 \$2 \$3" == "has-session -t tm-live" ]] && exit 0
exit 1
EOF
chmod +x "$TM_ROOT/bin/tmux"
export PATH="$TM_ROOT/bin:$PATH"

NODE="$(node -p 'process.execPath')"
tm() { "$NODE" "$PLUGIN_ROOT/bin/tm" "$@"; }
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }

echo "test-claim-renew"
git init -q "$TM_ROOT" && git -C "$TM_ROOT" -c user.email=t@e -c user.name=T commit -q --allow-empty -m init
tm init >/dev/null
tm config dispatch.enabled false >/dev/null # no pool: this test is the supervisor
tm epic new "Renew" >/dev/null
LIVE="$(tm task new "live worker" --body b --ac a | cut -d' ' -f1)"
DEAD="$(tm task new "dead worker" --body b --ac a | cut -d' ' -f1)"

# Each task as a one-shot `tm dispatch` left it after exiting: in progress, a tmux dispatch
# record, and a claim whose last heartbeat is five hours old (past the 240-minute TTL).
"$NODE" --input-type=module - "$PLUGIN_ROOT" "$LIVE" "$DEAD" <<'EOF'
const [root, live, dead] = process.argv.slice(2);
const { mutate, state, update, writeState } = await import(`${root}/lib/store.mjs`);
const old = new Date(Date.now() - 300 * 60_000).toISOString();
const claims = { ...state().claims };
for (const [id, session] of [[live, "tm-live"], [dead, "tm-dead"]]) {
  update(id, { status: "in_progress" });
  mutate(id, () => ({ dispatched: { backend: "tmux", run: `tmux:${session}`, session: `dispatch-${id}`, at: old } }));
  claims[id] = { session: `dispatch-${id}`, actor: "pool", pid: 1, ts: old };
}
writeState({ claims });
EOF
[[ $? -eq 0 && -n "$LIVE" && -n "$DEAD" ]] || { echo "  FAIL fixture setup"; exit 1; }

claim_ts() { "$NODE" -e 'const s=require(process.argv[1]+"/.bytedesk/task-management/state.json");console.log(s.claims[process.argv[2]]?.ts ?? "none")' "$TM_ROOT" "$1"; }
LIVE_BEFORE="$(claim_ts "$LIVE")"

OUT="$(tm claim renew --live 2>&1)"
RC=$?
[[ $RC -eq 0 ]] && ok "claim renew --live exits 0" || no "claim renew --live exits 0" "rc=$RC $OUT"
case "$OUT" in *"$LIVE: renewed (worker alive)"*) ok "the live worker is reported renewed" ;; *) no "the live worker is reported renewed" "$OUT" ;; esac
case "$OUT" in *"$DEAD: not renewed"*) ok "the dead worker is reported not renewed" ;; *) no "the dead worker is reported not renewed" "$OUT" ;; esac

LIVE_AFTER="$(claim_ts "$LIVE")"
[[ "$LIVE_AFTER" != "$LIVE_BEFORE" && "$LIVE_AFTER" > "$LIVE_BEFORE" ]] && ok "the live claim's timestamp moved forward" || no "the live claim's timestamp moved forward" "$LIVE_BEFORE -> $LIVE_AFTER"
case "$(tm show "$LIVE")" in *"in_progress"*) ok "the live task stays in progress" ;; *) no "the live task stays in progress" ;; esac
[[ "$(claim_ts "$DEAD")" == "none" ]] && ok "the dead worker's claim is not renewed (collected and released)" || no "the dead worker's claim is not renewed" "$(claim_ts "$DEAD")"
grep -q "has-session -t tm-live" "$TM_ROOT/tmux.calls" && grep -q "has-session -t tm-dead" "$TM_ROOT/tmux.calls" \
  && ok "liveness came from the tmux collector, for both" || no "liveness came from the tmux collector" "$(cat "$TM_ROOT/tmux.calls" 2>/dev/null)"

USAGE="$(tm claim renew 2>&1)"
[[ $? -eq 2 && "$USAGE" == *"--live"* ]] && ok "renew without --live is a usage error" || no "renew without --live is a usage error" "$USAGE"

echo "  $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
