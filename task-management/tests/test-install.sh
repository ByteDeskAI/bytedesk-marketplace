#!/usr/bin/env bash
# Clean-install contract: bootstrap once from the installed plugin, then use only
# the launchers committed under the project's task-management store.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="$(mktemp -d)"
HOME_DIR="$SANDBOX/home"
PROJECT="$SANDBOX/project with spaces"
trap 'rm -rf "$SANDBOX"' EXIT

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }

echo "test-install"

mkdir -p "$HOME_DIR" "$PROJECT"
git init -q "$PROJECT"
git -C "$PROJECT" remote add origin git@github.com:acme/stranger.git
git -C "$PROJECT" config user.name "A Stranger"
git -C "$PROJECT" config user.email stranger@example.com

# A copy, not a symlink: installed launchers cannot reach back into this checkout.
INSTALL="$HOME_DIR/.codex/plugins/cache/bytedesk/task-management/local"
mkdir -p "$(dirname "$INSTALL")"
cp -r "$PLUGIN_ROOT" "$INSTALL"
rm -rf "$INSTALL/dashboard/node_modules" "$INSTALL/.bytedesk"

stranger() {
  env -i HOME="$HOME_DIR" PATH="/usr/local/bin:/usr/bin:/bin" TERM=dumb \
    TM_PLUGIN_ROOT="$INSTALL" bash -lc "$1"
}

stranger "cd '$PROJECT' && node '$INSTALL/bin/tm' init" >/dev/null 2>&1
BIN="$PROJECT/.bytedesk/task-management/bin"
[[ -d "$PROJECT/.bytedesk/task-management/tasks" ]] \
  && ok "bootstrap creates a board in a new repository" \
  || no "bootstrap creates a board in a new repository"
for cmd in tm tm-dashboard tm-hook; do
  [[ -f "$BIN/$cmd" && -f "$BIN/$cmd.cmd" ]] \
    && ok "bootstrap writes project $cmd launchers" \
    || no "bootstrap writes project $cmd launchers"
  stranger "command -v $cmd" >/dev/null 2>&1 \
    && no "$cmd is absent from global PATH" \
    || ok "$cmd is absent from global PATH"
done

TM="'$BIN/tm'"
stranger "cd '$PROJECT' && $TM epic new 'First epic' && $TM task new 'first task' && $TM start TM-001" >/dev/null 2>&1
BOARD="$(stranger "cd '$PROJECT' && $TM board" 2>&1)"
case "$BOARD" in *"first task"*) ok "the project launcher manages tasks" ;; *) no "the project launcher manages tasks" "${BOARD:0:200}" ;; esac

CONFIG="$(cat "$PROJECT/.bytedesk/task-management/config.json")"
case "$CONFIG" in *"acme/stranger"*) ok "the board identifies the repository" ;; *) no "the board identifies the repository" ;; esac
case "$CONFIG" in *"A Stranger"*) ok "the board records its owner" ;; *) no "the board records its owner" ;; esac

DOCTOR="$(stranger "cd '$PROJECT' && $TM doctor" 2>&1)"
case "$DOCTOR" in *"no problems found"*) ok "doctor is clean after bootstrap" ;; *) no "doctor is clean after bootstrap" "${DOCTOR:0:200}" ;; esac

# The dashboard serves its committed bundle without npm install or network access.
stranger "cd '$PROJECT' && nohup '$BIN/tm-dashboard' > '$SANDBOX/dash.log' 2>&1 &" >/dev/null 2>&1
for _ in $(seq 1 20); do [[ -s "$PROJECT/.bytedesk/task-management/dashboard.port" ]] && break; sleep 0.5; done
PORT="$(cat "$PROJECT/.bytedesk/task-management/dashboard.port" 2>/dev/null || true)"
if [[ -n "$PORT" ]]; then
  [[ "$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")" == 200 ]] \
    && ok "the dashboard serves its page" || no "the dashboard serves its page"
  curl -s --max-time 5 "http://127.0.0.1:$PORT/api/board" | grep -q '"epics"' \
    && ok "the dashboard serves its board" || no "the dashboard serves its board"
  PID="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['pid'])" "$PROJECT/.bytedesk/task-management/dashboard.pid" 2>/dev/null || true)"
  [[ -n "$PID" ]] && kill "$PID" 2>/dev/null
else
  no "the dashboard starts" "no port file; log: $(tail -2 "$SANDBOX/dash.log" 2>/dev/null)"
fi

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
