#!/usr/bin/env bash
# Dashboard singleton behavior, against a real server. Self-isolating: every run
# gets a fresh TM_ROOT, and the trap kills anything this test started.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT
export CLAUDE_SESSION_ID="test-session"
unset TM_ENFORCE
unset TM_DASHBOARD_PORT
STORE="$TM_ROOT/.bytedesk/task-management"

cleanup() {
  local pid
  pid="$(pid_of || true)"
  [[ -n "${pid:-}" ]] && kill -9 "$pid" 2>/dev/null
  for job in $(jobs -p); do kill -9 "$job" 2>/dev/null; done
  rm -rf "$TM_ROOT"
}
trap cleanup EXIT

tm() { node "$PLUGIN_ROOT/bin/tm" "$@"; }
dash() { node "$PLUGIN_ROOT/bin/tm-dashboard" "$@"; }
# Calls that must return promptly: a hang here is a failure, not a stalled suite.
dashq() { timeout 10 node "$PLUGIN_ROOT/bin/tm-dashboard" "$@"; }
pid_of() { node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).pid))}catch{}' "$STORE/dashboard.pid"; }
port_of() { cat "$STORE/dashboard.port" 2>/dev/null; }

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }

assert_contains() { # <haystack> <needle> <name>
  case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected to contain: $2" ;; esac
}
assert_status() { # <expected-exit> <name> <cmd...>
  local want="$1" name="$2"; shift 2
  "$@" >/dev/null 2>&1
  local got=$?
  [[ "$got" == "$want" ]] && ok "$name" || no "$name" "exit $got, wanted $want"
}

# Wait until the board answers on its port, or give up.
wait_up() {
  for _ in $(seq 1 50); do
    [[ -n "$(port_of)" ]] && curl -fsS --max-time 1 "http://127.0.0.1:$(port_of)/api/board" >/dev/null 2>&1 && return 0
    sleep 0.1
  done
  return 1
}
wait_gone() { # <pid>
  for _ in $(seq 1 50); do kill -0 "$1" 2>/dev/null || return 0; sleep 0.1; done
  return 1
}

echo "test-dashboard"

tm init >/dev/null
tm epic new "Dashboard epic" >/dev/null
tm task new "Visible on the board" >/dev/null

# ── no server yet ────────────────────────────────────────────────────────────
assert_status 1 "--status exits 1 when nothing is running" dashq --status

# ── first launch ─────────────────────────────────────────────────────────────
dash >"$TM_ROOT/first.log" 2>&1 &
FIRST_JOB=$!
wait_up && ok "the dashboard comes up and serves /api/board" || no "the dashboard comes up and serves /api/board" "$(cat "$TM_ROOT/first.log")"
PORT="$(port_of)"
FIRST_PID="$(pid_of)"

assert_contains "$(curl -fsS "http://127.0.0.1:$PORT/api/board")" "TM-001" "/api/board serves the real store"
[[ "$PORT" -gt 45000 && "$PORT" -lt 65000 ]] && ok "the port lands above 45000" || no "the port lands above 45000" "got $PORT"

# The assignment is persisted, not re-derived at each launch.
ASSIGNED="$(cat "$STORE/dashboard.assigned-port" 2>/dev/null)"
[[ "$PORT" == "$ASSIGNED" ]] && ok "the port is persisted as this project's assignment" || no "the port is persisted as this project's assignment" "$PORT vs '$ASSIGNED'"

# ── the data the board's metrics need ────────────────────────────────────────
assert_contains "$(curl -fsS "http://127.0.0.1:$PORT/api/events")" '"event":"create"' "/api/events serves the event log"

# ── the built Atlassian SPA ──────────────────────────────────────────────────
# dist/ is committed on purpose: `/plugin install` must not require npm install.
[[ -f "$PLUGIN_ROOT/dashboard/dist/index.html" ]] && ok "the built dashboard ships in the repo" || no "the built dashboard ships in the repo" "dashboard/dist/index.html is missing — run: cd dashboard && npm run build"
PAGE_HTML="$(curl -fsS "http://127.0.0.1:$PORT/")"
assert_contains "$PAGE_HTML" '<div id="root">' "the SPA shell is served at /"
case "$PAGE_HTML" in
  *"http://"*|*"https://"*) no "the page makes no external requests" "the shell references an absolute URL" ;;
  *) ok "the page makes no external requests" ;;
esac
ASSET="$(printf '%s' "$PAGE_HTML" | grep -o '/assets/[A-Za-z0-9._-]*\.js' | head -1)"
[[ -n "$ASSET" ]] && ok "the shell links a hashed bundle" || no "the shell links a hashed bundle" "no /assets/*.js in the page"
assert_contains "$(curl -fsS -D- -o /dev/null "http://127.0.0.1:$PORT$ASSET")" "javascript" "bundles are served as javascript"
assert_contains "$(curl -fsS "http://127.0.0.1:$PORT$ASSET")" "task-management" "the bundle is the real board app"
TRAVERSAL="$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/assets/../../../../../../etc/passwd")"
[[ "$TRAVERSAL" == "404" ]] && ok "asset paths cannot escape dist/" || no "asset paths cannot escape dist/" "got HTTP $TRAVERSAL"

# ── PWA: installable, offline-capable (TM-029) ───────────────────────────────
# All three files are generated at build time and served from dist/, so a broken
# build shows up here rather than as a board that silently stops installing.
MANIFEST_HEAD="$(curl -fsS -D- -o "$TM_ROOT/manifest.json" "http://127.0.0.1:$PORT/manifest.webmanifest")"
assert_contains "$MANIFEST_HEAD" "application/manifest+json" "the manifest is served as application/manifest+json"
MANIFEST="$(cat "$TM_ROOT/manifest.json")"
for field in '"name"' '"short_name"' '"description"' '"start_url"' '"scope"' '"display"' '"orientation"' \
             '"theme_color"' '"background_color"' '"icons"'; do
  assert_contains "$MANIFEST" "$field" "the manifest declares $field"
done
assert_contains "$MANIFEST" '"display":"standalone"' "the manifest asks for a standalone window"
assert_contains "$MANIFEST" '"scope":"/"' "the manifest scopes to the whole board"
assert_contains "$MANIFEST" '"purpose":"maskable"' "the manifest ships a maskable icon"
assert_contains "$PAGE_HTML" 'rel="manifest"' "the page links its manifest"

# The service worker must be reachable at the site root or it cannot control /.
SW_HEAD="$(curl -fsS -D- -o "$TM_ROOT/sw.js" "http://127.0.0.1:$PORT/sw.js")"
assert_contains "$SW_HEAD" "javascript" "the service worker is served as javascript"
assert_contains "$SW_HEAD" "no-cache" "the service worker itself is never cached"
case "$SW_HEAD" in
  *immutable*) no "the service worker is not served immutable" "found immutable on /sw.js" ;;
  *) ok "the service worker is not served immutable" ;;
esac
assert_contains "$(cat "$TM_ROOT/sw.js")" "addEventListener" "the service worker is real javascript, not a stub"
# The precache list must be substituted into the *code*, not just appear somewhere
# in the file. A leftover build token throws ReferenceError on install and the
# worker never registers — silently, which is how this shipped broken once.
assert_contains "$(cat "$TM_ROOT/sw.js")" 'const PRECACHE = ["/"' "the service worker precaches the hashed app shell"
case "$(cat "$TM_ROOT/sw.js")" in
  *__VERSION__*|*__PRECACHE__*) no "no build token survives into the served worker" "an unsubstituted __TOKEN__ is still in sw.js" ;;
  *) ok "no build token survives into the served worker" ;;
esac
# It must also parse. `node --check` is the cheapest proof the emitted file is
# syntactically a program and not a truncated write.
if node --check "$TM_ROOT/sw.js" 2>/dev/null; then
  ok "the served worker parses as javascript"
else
  no "the served worker parses as javascript" "node --check failed"
fi

# Icons: generated by the build, never pasted in as blobs.
for icon in icon-192.png icon-512.png maskable-512.png; do
  ICON_HEAD="$(curl -fsS -D- -o "$TM_ROOT/$icon" "http://127.0.0.1:$PORT/icons/$icon" 2>/dev/null)"
  assert_contains "$ICON_HEAD" "image/png" "/icons/$icon is served as a png"
  # The 8-byte PNG signature, not just a file with the right name.
  if [[ "$(head -c 8 "$TM_ROOT/$icon" | od -An -tx1 | tr -d ' \n')" == "89504e470d0a1a0a" ]]; then
    ok "/icons/$icon is a real png"
  else
    no "/icons/$icon is a real png" "bad signature"
  fi
  assert_contains "$MANIFEST" "/icons/$icon" "the manifest references $icon"
done

# The traversal guard covers the icon route too — same resolve+prefix check.
for probe in "/icons/../../../../../../etc/passwd" "/icons/..%2f..%2f..%2f..%2f..%2f..%2fetc/passwd"; do
  CODE="$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$probe")"
  [[ "$CODE" == "404" ]] && ok "icon paths cannot escape dist ($probe)" || no "icon paths cannot escape dist ($probe)" "got HTTP $CODE"
done

# A write must never be answered from a cache. The board's own writes are POSTs,
# which the worker declines to touch — assert the intent is stated in the file.
assert_contains "$(cat "$TM_ROOT/sw.js")" "GET" "the service worker only ever caches GETs"

# ── second launch: first-wins ────────────────────────────────────────────────
SECOND_OUT="$(dashq 2>&1)"
SECOND_RC=$?
[[ "$SECOND_RC" == 0 ]] && ok "a second launch exits 0" || no "a second launch exits 0" "exit $SECOND_RC"
assert_contains "$SECOND_OUT" "http://127.0.0.1:$PORT" "a second launch prints the running URL"
[[ "$(pid_of)" == "$FIRST_PID" ]] && ok "a second launch does not replace the incumbent" || no "a second launch does not replace the incumbent" "pid $(pid_of) != $FIRST_PID"
kill -0 "$FIRST_PID" 2>/dev/null && ok "the original server is still alive" || no "the original server is still alive"
assert_contains "$(curl -fsS "http://127.0.0.1:$PORT/api/board")" "TM-001" "the original server is still serving"

# ── --status ─────────────────────────────────────────────────────────────────
STATUS_OUT="$(dashq --status)"
STATUS_RC=$?
[[ "$STATUS_RC" == 0 ]] && ok "--status exits 0 while running" || no "--status exits 0 while running" "exit $STATUS_RC"
assert_contains "$STATUS_OUT" "http://127.0.0.1:$PORT" "--status reports the URL"
assert_contains "$STATUS_OUT" "$FIRST_PID" "--status reports the pid"

# ── --restart ────────────────────────────────────────────────────────────────
dash --restart >"$TM_ROOT/restart.log" 2>&1 &
wait_gone "$FIRST_PID" && ok "--restart stops the incumbent" || no "--restart stops the incumbent" "pid $FIRST_PID survived"
wait_up && ok "--restart brings a new server up on the same port" || no "--restart brings a new server up on the same port" "$(cat "$TM_ROOT/restart.log")"
NEW_PID="$(pid_of)"
[[ -n "$NEW_PID" && "$NEW_PID" != "$FIRST_PID" ]] && ok "--restart records the new pid" || no "--restart records the new pid" "pid still $NEW_PID"
[[ "$(port_of)" == "$PORT" ]] && ok "--restart keeps the project's port" || no "--restart keeps the project's port" "got $(port_of)"

# ── the assignment survives a full stop ──────────────────────────────────────
kill "$NEW_PID" 2>/dev/null
wait_gone "$NEW_PID" && ok "the server exits on SIGTERM" || no "the server exits on SIGTERM"
[[ ! -f "$STORE/dashboard.pid" ]] && ok "shutdown clears the pid file" || no "shutdown clears the pid file"

dash >"$TM_ROOT/third.log" 2>&1 &
wait_up || no "the dashboard restarts after a full stop" "$(cat "$TM_ROOT/third.log")"
[[ "$(port_of)" == "$PORT" ]] && ok "the same project opens the same port on every load" || no "the same project opens the same port on every load" "got $(port_of), wanted $PORT"
THIRD_PID="$(pid_of)"
kill "$THIRD_PID" 2>/dev/null
wait_gone "$THIRD_PID"

# ── TM_DASHBOARD_PORT overrides without stealing the assignment ──────────────
TM_DASHBOARD_PORT=7999 node "$PLUGIN_ROOT/bin/tm-dashboard" >"$TM_ROOT/env.log" 2>&1 &
for _ in $(seq 1 50); do curl -fsS --max-time 1 "http://127.0.0.1:7999/api/board" >/dev/null 2>&1 && break; sleep 0.1; done
assert_contains "$(curl -fsS "http://127.0.0.1:7999/api/board")" "TM-001" "TM_DASHBOARD_PORT overrides the assignment"
[[ "$(cat "$STORE/dashboard.assigned-port")" == "$PORT" ]] && ok "an override does not clobber the stored assignment" || no "an override does not clobber the stored assignment" "assignment became $(cat "$STORE/dashboard.assigned-port")"
ENV_PID="$(pid_of)"
kill "$ENV_PID" 2>/dev/null
wait_gone "$ENV_PID"

# ── writes (TM-026) ──────────────────────────────────────────────────────────
# The assertion that counts is on the store: the markdown changed and the event
# log grew. An HTTP 200 proves nothing on its own.
dash >"$TM_ROOT/write.log" 2>&1 &
wait_up || no "the board comes back up for the write tests" "$(cat "$TM_ROOT/write.log")"
WRITE_PID="$(pid_of)"
BASE="http://127.0.0.1:$PORT"

post() { curl -s -o "$TM_ROOT/resp.json" -w '%{http_code}' -X "${3:-POST}" -H 'content-type: application/json' -d "${2:-{\}}" "$BASE$1"; }
body() { cat "$TM_ROOT/resp.json"; }
md() { cat "$STORE"/tasks/"$1"-*.md 2>/dev/null; }
events() { wc -l < "$STORE/events.jsonl"; }

CODE="$(post /api/task '{"title":"Written from the board"}')"
[[ "$CODE" == 201 ]] && ok "create returns 201" || no "create returns 201" "got $CODE: $(body)"
[[ -n "$(md TM-002)" ]] && ok "create wrote the markdown file" || no "create wrote the markdown file" "no TM-002-*.md in the store"
assert_contains "$(md TM-002)" "Written from the board" "the new task carries its title"
assert_contains "$(node "$PLUGIN_ROOT/bin/tm" log 100)" "TM-002" "create appended an event"

# Acceptance criteria are editable from the board, or the done gate is a dead end.
CODE="$(post /api/task/TM-002/ac '{"text":"proven by a test"}')"
[[ "$CODE" == 200 ]] && ok "acceptance criteria can be added from the board" || no "acceptance criteria can be added from the board" "got $CODE: $(body)"
assert_contains "$(md TM-002)" "proven by a test" "the criterion is in the markdown"

# The done gate must refuse exactly as `tm done` does, and say why.
BEFORE_EVENTS="$(events)"
CODE="$(post /api/task/TM-002/transition '{"status":"done"}')"
[[ "$CODE" == 409 ]] && ok "closing with unmet acceptance criteria is refused" || no "closing with unmet acceptance criteria is refused" "got $CODE"
assert_contains "$(body)" "unmet acceptance criteria" "the refusal carries the gate's reason"
assert_contains "$(md TM-002)" 'status: "open"' "a refused transition does not touch the markdown"
[[ "$(events)" == "$BEFORE_EVENTS" ]] && ok "a refused transition logs nothing" || no "a refused transition logs nothing" "$BEFORE_EVENTS -> $(events)"

post /api/task/TM-002/accept '{"index":1}' >/dev/null
CODE="$(post /api/task/TM-002/transition '{"status":"done"}')"
[[ "$CODE" == 200 ]] && ok "closing is allowed once the criteria are met" || no "closing is allowed once the criteria are met" "got $CODE: $(body)"
assert_contains "$(md TM-002)" 'status: "done"' "the transition changed the markdown"
assert_contains "$(node "$PLUGIN_ROOT/bin/tm" log 100 --json)" '"event": "done"' "the transition appended a done event"

# Starting work from the board takes the claim, like `tm start` does.
post /api/task/TM-001/transition '{"status":"in_progress"}' >/dev/null
assert_contains "$(md TM-001)" 'status: "in_progress"' "the board can start work"
assert_contains "$(cat "$STORE/state.json")" '"TM-001"' "starting from the board takes the claim"
post /api/task/TM-001/transition '{"status":"parked"}' >/dev/null
case "$(cat "$STORE/state.json")" in *'"TM-001"'*) no "parking releases the claim" "TM-001 still claimed" ;; *) ok "parking releases the claim" ;; esac

# Jira-shaped field writes, all through lib/issue.mjs.
post /api/task/TM-001/assign '{"assignee":"ryan"}' >/dev/null
assert_contains "$(md TM-001)" 'assignee: "ryan"' "assign writes the assignee"
post /api/task/TM-001/labels '{"add":["ui","board"]}' >/dev/null
assert_contains "$(md TM-001)" '"ui"' "labels are written"
post /api/task/TM-001/priority '{"priority":"high"}' >/dev/null
assert_contains "$(md TM-001)" 'priority: "high"' "priority is written"
post /api/task/TM-001/estimate '{"estimate":3}' >/dev/null
assert_contains "$(md TM-001)" "estimate: 3" "estimate is written"
post /api/task/TM-001/comment '{"text":"looks right"}' >/dev/null
assert_contains "$(md TM-001)" "looks right" "comments are written"
CODE="$(post /api/task/TM-001/priority '{"priority":"urgent"}')"
[[ "$CODE" == 400 ]] && ok "an invalid priority is refused" || no "an invalid priority is refused" "got $CODE"
CODE="$(post /api/task/TM-001 '{"title":"Renamed from the board"}' PATCH)"
[[ "$CODE" == 200 ]] && ok "edit returns 200" || no "edit returns 200" "got $CODE: $(body)"
assert_contains "$(md TM-001)" "Renamed from the board" "edit rewrites the title"

# Links write both ends; subtasks and rank move real fields.
post /api/task/TM-001/link '{"type":"blocks","to":"TM-002"}' >/dev/null
assert_contains "$(md TM-001)" '"blocks"' "a link is written on the near end"
assert_contains "$(md TM-002)" '"blocked by"' "a link is mirrored onto the far end"
post /api/task '{"title":"A child task"}' >/dev/null
post /api/task/TM-003/subtask '{"parent":"TM-001"}' >/dev/null
assert_contains "$(md TM-003)" 'parent: "TM-001"' "a subtask records its parent"
CODE="$(post /api/task/TM-001/subtask '{"parent":"TM-001"}')"
[[ "$CODE" == 400 ]] && ok "a cyclic subtask is refused" || no "a cyclic subtask is refused" "got $CODE"
post /api/task/TM-003/rank '{"before":"TM-001"}' >/dev/null
assert_contains "$(md TM-003)" "rank:" "a drag writes a rank"
assert_contains "$(curl -fsS "$BASE/api/backlog")" "TM-003" "the backlog is served in order"

# Bulk edit is one request, several store writes.
post /api/bulk '{"ids":["TM-001","TM-003"],"op":"priority","args":{"priority":"low"}}' >/dev/null
assert_contains "$(md TM-001)" 'priority: "low"' "bulk edit writes the first task"
assert_contains "$(md TM-003)" 'priority: "low"' "bulk edit writes the second task"

# A write from one client reaches every other: the SSE feed tails the same log.
(curl -sN --max-time 3 "$BASE/events" > "$TM_ROOT/sse.txt" &) ; sleep 0.5
post /api/task/TM-003/assign '{"assignee":"someone-else"}' >/dev/null
sleep 1
assert_contains "$(cat "$TM_ROOT/sse.txt")" "TM-003" "a write is pushed to other clients over SSE"

CODE="$(post /api/task/TM-001/nonsense)"
[[ "$CODE" == 404 ]] && ok "an unknown action is refused" || no "an unknown action is refused" "got $CODE"

kill "$WRITE_PID" 2>/dev/null
wait_gone "$WRITE_PID"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
