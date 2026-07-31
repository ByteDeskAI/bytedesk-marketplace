#!/usr/bin/env bash
# TM-048 — the install path a stranger follows, run as one.
#
# Every other suite runs against this checkout with ~/.claude already populated, node already
# present and a store that has existed for days. That is how a documented command that did not
# exist (TM-046) shipped as supported under a fully green suite: the tests invoked the entrypoint
# by absolute path and never the instruction.
#
# So this one takes nothing for granted: an empty HOME, a copy of the plugin rather than a symlink
# back into the checkout, and only what `tm install` puts on PATH.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="$(mktemp -d)"
HOME_DIR="$SANDBOX/home"
PROJECT="$SANDBOX/project"
trap 'rm -rf "$SANDBOX"' EXIT

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }

echo "test-install"

mkdir -p "$HOME_DIR/.local/bin" "$PROJECT"
git init -q "$PROJECT"
git -C "$PROJECT" remote add origin git@github.com:acme/stranger.git
git -C "$PROJECT" config user.name "A Stranger"
git -C "$PROJECT" config user.email stranger@example.com

# A copy, not a symlink: an installed plugin has no path back to this working tree.
INSTALL="$HOME_DIR/.claude/plugins/cache/bytedesk/task-management"
mkdir -p "$(dirname "$INSTALL")"
cp -r "$PLUGIN_ROOT" "$INSTALL"
rm -rf "$INSTALL/dashboard/node_modules" "$INSTALL/.bytedesk"

# env -i: no PATH, no HOME, none of this session's variables. Only what the install provides.
stranger() { env -i HOME="$HOME_DIR" PATH="$HOME_DIR/.local/bin:/usr/local/bin:/usr/bin:/bin" TERM=dumb bash -lc "$1"; }

stranger "'$INSTALL/bin/tm' install" >/dev/null 2>&1
for cmd in tm tm-dashboard tm-hook; do
  stranger "command -v $cmd" >/dev/null 2>&1 && ok "$cmd is on PATH after tm install" || no "$cmd is on PATH after tm install"
done

stranger "cd '$PROJECT' && tm init" >/dev/null 2>&1
[[ -d "$PROJECT/.bytedesk/task-management/tasks" ]] && ok "tm init creates a board in a repo it has never seen" || no "tm init creates a board in a repo it has never seen"

stranger "cd '$PROJECT' && tm epic new 'First epic' && tm task new 'first task' && tm start TM-001" >/dev/null 2>&1
BOARD="$(stranger "cd '$PROJECT' && tm board" 2>&1)"
case "$BOARD" in *"first task"*) ok "a task can be created and moved" ;; *) no "a task can be created and moved" "${BOARD:0:200}" ;; esac

# Identity comes from the stranger's git, not from this machine's.
CONFIG="$(cat "$PROJECT/.bytedesk/task-management/config.json")"
case "$CONFIG" in *"acme/stranger"*) ok "the board identifies itself by their repo" ;; *) no "the board identifies itself by their repo" ;; esac
case "$CONFIG" in *"A Stranger"*) ok "and records them as its owner" ;; *) no "and records them as its owner" ;; esac

DOCTOR="$(stranger "cd '$PROJECT' && tm doctor" 2>&1)"
case "$DOCTOR" in *"no problems found"*) ok "doctor is clean on a store nothing else has touched" ;; *) no "doctor is clean on a store nothing else has touched" "${DOCTOR:0:200}" ;; esac

# The dashboard serves its own committed bundle — no npm install, no network.
stranger "cd '$PROJECT' && nohup tm-dashboard > '$SANDBOX/dash.log' 2>&1 &" >/dev/null 2>&1
for _ in $(seq 1 20); do [[ -s "$PROJECT/.bytedesk/task-management/dashboard.port" ]] && break; sleep 0.5; done
PORT="$(cat "$PROJECT/.bytedesk/task-management/dashboard.port" 2>/dev/null || true)"
if [[ -n "$PORT" ]]; then
  [[ "$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")" == 200 ]] \
    && ok "the dashboard serves its page" || no "the dashboard serves its page"
  curl -s --max-time 5 "http://127.0.0.1:$PORT/api/board" | grep -q '"epics"' \
    && ok "and its board" || no "and its board"
  ASSET="$(curl -s --max-time 5 "http://127.0.0.1:$PORT/" | grep -o 'assets/index-[^"]*js' | head -1)"
  [[ "$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/$ASSET")" == 200 ]] \
    && ok "the committed bundle is there — no npm install required" || no "the committed bundle is there"
  PID="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['pid'])" "$PROJECT/.bytedesk/task-management/dashboard.pid" 2>/dev/null || true)"
  [[ -n "$PID" ]] && kill "$PID" 2>/dev/null
else
  no "the dashboard starts" "no port file; log: $(tail -2 "$SANDBOX/dash.log" 2>/dev/null)"
fi

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
