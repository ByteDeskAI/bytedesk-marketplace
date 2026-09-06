#!/usr/bin/env bash
# Dashboard singleton behavior, against a real server. Self-isolating: every run
# gets a fresh TM_ROOT, and the trap kills anything this test started.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT
# The name Claude Code actually sets. The suites used to export CLAUDE_SESSION_ID, which
# nothing sets — so every session-dependent path was exercised with a variable production
# never had, and 9 suites stayed green while claims, gates and attribution were all inert.
export CLAUDE_CODE_SESSION_ID="test-session"
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
tm task new "Visible on the board" --body "proves the board serves the store" --ac "the board shows it" >/dev/null

# ── flags, before anything is running ────────────────────────────────────────
assert_status 1 "--status exits 1 when nothing is running" dashq --status

# `--help` used to fall through every check and start a SERVER: it bound the port, served the
# board, and sat in `ps` looking like a hung help invocation for as long as it ran. Two boards on
# this machine were running that way, and the only way to tell one from a real launch was to ask
# its port what it was serving.
HELP_OUT="$(dashq --help 2>&1)"
assert_status 0 "--help exits 0" dashq --help
assert_contains "$HELP_OUT" "tm-dashboard --restart" "--help prints the usage"
assert_contains "$HELP_OUT" "--browser / --no-browser" "--help documents the browser overrides"
[[ -z "$(pid_of)" ]] && ok "--help starts no server" || no "--help starts no server" "pid file: $(pid_of)"
# In a VIRGIN root, so it measures what it claims: this suite has already seeded a store above,
# and asserting "$STORE does not exist" there would pass or fail for reasons unrelated to --help.
# `paths()` and `ensureDirs()` run at import time, so a help path that reached them would create a
# store just by being asked for help.
VIRGIN="$(mktemp -d)"
TM_ROOT="$VIRGIN" CLAUDE_PROJECT_DIR="$VIRGIN" timeout 10 node "$PLUGIN_ROOT/bin/tm-dashboard" --help >/dev/null 2>&1
[[ -z "$(ls -A "$VIRGIN" 2>/dev/null)" ]] && ok "--help creates nothing in an empty project" \
  || no "--help creates nothing in an empty project" "created: $(ls -A "$VIRGIN" | tr '\n' ' ')"
rm -rf "$VIRGIN"
assert_status 0 "-h is the same" dashq -h

# An unrecognised flag is refused rather than ignored — being ignored is exactly how `--help`
# reached the server-start path.
assert_status 2 "an unknown flag exits 2" dashq --halp
assert_contains "$(dashq --halp 2>&1)" "unknown option --halp" "an unknown flag is named"
[[ -z "$(pid_of)" ]] && ok "an unknown flag starts no server" || no "an unknown flag starts no server" "pid file: $(pid_of)"

# ── first launch ─────────────────────────────────────────────────────────────
dash >"$TM_ROOT/first.log" 2>&1 &
wait_up && ok "the dashboard comes up and serves /api/board" || no "the dashboard comes up and serves /api/board" "$(cat "$TM_ROOT/first.log")"
PORT="$(port_of)"
FIRST_PID="$(pid_of)"

assert_contains "$(curl -fsS "http://127.0.0.1:$PORT/api/board")" "TM-001" "/api/board serves the real store"
[[ "$PORT" -gt 45000 && "$PORT" -lt 65000 ]] && ok "the port lands above 45000" || no "the port lands above 45000" "got $PORT"

# The assignment is persisted, not re-derived at each launch.
ASSIGNED="$(cat "$STORE/port.assigned" 2>/dev/null)"
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
[[ "$(cat "$STORE/port.assigned")" == "$PORT" ]] && ok "an override does not clobber the stored assignment" || no "an override does not clobber the stored assignment" "assignment became $(cat "$STORE/port.assigned")"
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

CODE="$(post /api/task '{"title":"Written from the board","body":"context from the board","acceptance":["the create round-trips"]}')"
[[ "$CODE" == 201 ]] && ok "create returns 201" || no "create returns 201" "got $CODE: $(body)"
[[ -n "$(md TM-002)" ]] && ok "create wrote the markdown file" || no "create wrote the markdown file" "no TM-002-*.md in the store"
assert_contains "$(md TM-002)" "Written from the board" "the new task carries its title"
assert_contains "$(md TM-002)" "the create round-trips" "a payload acceptance list is honored without a template"
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
post /api/task/TM-002/accept '{"index":2}' >/dev/null
# Ticked criteria alone do not close a task: done also wants evidence and attribution.
CODE="$(post /api/task/TM-002/transition '{"status":"done"}')"
[[ "$CODE" == 409 ]] && ok "closing without evidence and an assignee is refused" || no "closing without evidence and an assignee is refused" "got $CODE: $(body)"
assert_contains "$(body)" "evidence" "the refusal names the missing evidence"
post /api/task/TM-002/evidence '{"text":"verified from the board"}' >/dev/null
post /api/task/TM-002/assign '{"assignee":"board-tester"}' >/dev/null
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
# The board could create a task under the active epic and never move it out again — PATCH took
# title and body only, so the one surface that could edit anything could not refile anything.
# Destination can come from the CLI or from `POST /api/epic { title }` — `{ id }` still activates.
tm epic new "A second epic" >/dev/null
CODE="$(post /api/task/TM-001 '{"epic":"EP-002"}' PATCH)"
[[ "$CODE" == 200 ]] && ok "the board can refile a task under another epic" || no "the board can refile a task" "got $CODE: $(body)"
assert_contains "$(md TM-001)" 'epic: "EP-002"' "the move is written to the file"
CODE="$(post /api/task/TM-001 '{"epic":"EP-404"}' PATCH)"
[[ "$CODE" == 400 ]] && ok "a move to an epic that does not exist is refused" || no "a move to a missing epic is refused" "got $CODE"
post /api/task/TM-001 '{"epic":"EP-001"}' PATCH >/dev/null   # put it back for what follows
post /api/epic '{"id":"EP-001"}' >/dev/null

# BDM-65/66: epic detail includes body; list does not; create is `{ title }` not `{ id }`.
CODE="$(post /api/epic '{"title":"Opened from the board","body":"the epic body"}')"
[[ "$CODE" == 201 ]] && ok "creating an epic from the board returns 201" || no "creating an epic from the board" "got $CODE: $(body)"
assert_contains "$(body)" '"activeEpic"' "create sets the new epic active"
assert_contains "$(curl -fsS "http://127.0.0.1:$PORT/api/epic/EP-003")" "the epic body" "GET /api/epic/:id includes the body"
case "$(curl -fsS "http://127.0.0.1:$PORT/api/board")" in
  *"the epic body"*) no "/api/board stays body-stripped" "list shipped the body" ;;
  *) ok "/api/board stays body-stripped" ;;
esac
CODE="$(curl -s -o "$TM_ROOT/resp.json" -w '%{http_code}' "http://127.0.0.1:$PORT/api/task/EP-003")"
[[ "$CODE" == 400 ]] && ok "GET /api/task/EP-* is still 400" || no "GET /api/task/EP-* is still 400" "got $CODE: $(body)"
# BDM-70 — GET /api/adr/:id must be wired here; handleWrite is only reached from POST/PATCH
# for writes. An empty adrs/ is `[]` on the board; ADR-* is not a task.
CODE="$(post /api/adr '{"title":"Use markdown files","body":"the adr body"}')"
[[ "$CODE" == 201 ]] && ok "creating an ADR from the board returns 201" || no "creating an ADR from the board" "got $CODE: $(body)"
assert_contains "$(curl -fsS "http://127.0.0.1:$PORT/api/adr/ADR-0001")" "the adr body" "GET /api/adr/:id includes the body"
assert_contains "$(curl -fsS "http://127.0.0.1:$PORT/api/board")" '"adrs":[' "/api/board includes the adrs list"
CODE="$(curl -s -o "$TM_ROOT/resp.json" -w '%{http_code}' "http://127.0.0.1:$PORT/api/task/ADR-0001")"
[[ "$CODE" == 400 ]] && ok "GET /api/task/ADR-* is still 400" || no "GET /api/task/ADR-* is still 400" "got $CODE: $(body)"
# BDM-73 — GET /api/capability/:id must be wired here; empty capabilities/ is `[]`.
CODE="$(post /api/capability '{"title":"Cheap win","impact":"H","effort":"S","confidence":"H"}')"
[[ "$CODE" == 201 ]] && ok "proposing a capability from the board returns 201" || no "proposing a capability from the board" "got $CODE: $(body)"
assert_contains "$(curl -fsS "http://127.0.0.1:$PORT/api/capability/CAP-0001")" "Cheap win" "GET /api/capability/:id includes the record"
assert_contains "$(curl -fsS "http://127.0.0.1:$PORT/api/board")" '"capabilities":[' "/api/board includes the capabilities list"
CODE="$(curl -s -o "$TM_ROOT/resp.json" -w '%{http_code}' "http://127.0.0.1:$PORT/api/task/CAP-0001")"
[[ "$CODE" == 400 ]] && ok "GET /api/task/CAP-* is still 400" || no "GET /api/task/CAP-* is still 400" "got $CODE: $(body)"
CODE="$(post /api/capability/CAP-0001/ship '{}')"
[[ "$CODE" == 409 ]] && ok "shipping a capability without evidence is 409" || no "shipping a capability without evidence is 409" "got $CODE: $(body)"
# BDM-74 — generic entity read is wired here; /api/task/EP-* stays requireTask.
CODE="$(curl -s -o "$TM_ROOT/resp.json" -w '%{http_code}' "http://127.0.0.1:$PORT/api/entity/EP-001")"
[[ "$CODE" == 200 ]] && ok "GET /api/entity/EP-* is 200" || no "GET /api/entity/EP-* is 200" "got $CODE: $(body)"
CODE="$(curl -s -o "$TM_ROOT/resp.json" -w '%{http_code}' "http://127.0.0.1:$PORT/api/entity/TM-001")"
[[ "$CODE" == 200 ]] && ok "GET /api/entity/TM-* is 200" || no "GET /api/entity/TM-* is 200" "got $CODE: $(body)"
CODE="$(curl -s -o "$TM_ROOT/resp.json" -w '%{http_code}' "http://127.0.0.1:$PORT/api/entity/ADR-0001")"
[[ "$CODE" == 200 ]] && ok "GET /api/entity/ADR-* is 200" || no "GET /api/entity/ADR-* is 200" "got $CODE: $(body)"
CODE="$(curl -s -o "$TM_ROOT/resp.json" -w '%{http_code}' "http://127.0.0.1:$PORT/api/entity/CAP-0001")"
[[ "$CODE" == 200 ]] && ok "GET /api/entity/CAP-* is 200" || no "GET /api/entity/CAP-* is 200" "got $CODE: $(body)"
CODE="$(post /api/sprint '{"title":"Entity sprint"}')"
[[ "$CODE" == 201 ]] && ok "creating a sprint for entity GET" || no "creating a sprint for entity GET" "got $CODE: $(body)"
CODE="$(curl -s -o "$TM_ROOT/resp.json" -w '%{http_code}' "http://127.0.0.1:$PORT/api/entity/SP-001")"
[[ "$CODE" == 200 ]] && ok "GET /api/entity/SP-* is 200" || no "GET /api/entity/SP-* is 200" "got $CODE: $(body)"
CODE="$(curl -s -o "$TM_ROOT/resp.json" -w '%{http_code}' "http://127.0.0.1:$PORT/api/task/EP-001")"
[[ "$CODE" == 400 ]] && ok "GET /api/task/EP-* is still 400 after /api/entity" || no "GET /api/task/EP-* is still 400 after /api/entity" "got $CODE"
CODE="$(curl -s -o "$TM_ROOT/resp.json" -w '%{http_code}' "http://127.0.0.1:$PORT/api/worktrees")"
[[ "$CODE" == 200 ]] && ok "GET /api/worktrees is 200" || no "GET /api/worktrees is 200" "got $CODE: $(body)"
assert_contains "$(cat "$TM_ROOT/resp.json")" "[]" "empty worktrees list is []"
post /api/epic '{"id":"EP-001"}' >/dev/null

# Acceptance criteria are not a one-way door. Reported by a user who ticked one on the board and
# could not untick it — the checkbox set isDisabled once checked, and no route unticked.
# TM-001 carries its create-time criterion at index 1, so the two added here are 2 and 3.
post /api/task/TM-001/ac '{"text":"the tickable one"}' >/dev/null
post /api/task/TM-001/ac '{"text":"the removable one"}' >/dev/null
post /api/task/TM-001/accept '{"index":2}' >/dev/null
assert_contains "$(md TM-001)" '"done":true' "the board ticks a criterion"
CODE="$(post /api/task/TM-001/accept '{"index":2,"done":false}')"
[[ "$CODE" == 200 ]] && ok "the board unticks it again" || no "the board unticks it again" "got $CODE: $(body)"
case "$(md TM-001)" in
  *'"done":true'*) no "the untick is written to the file" "still ticked" ;;
  *) ok "the untick is written to the file" ;;
esac
CODE="$(post /api/task/TM-001/accept '{"index":3,"remove":true}')"
[[ "$CODE" == 200 ]] && ok "the board removes a criterion" || no "the board removes a criterion" "got $CODE: $(body)"
case "$(md TM-001)" in
  *"the removable one"*) no "the removed criterion is gone from the file" "still there" ;;
  *) ok "the removed criterion is gone from the file" ;;
esac
CODE="$(post /api/task/TM-001/accept '{"index":99}')"
[[ "$CODE" == 400 ]] && ok "an index that does not exist is refused" || no "an index that does not exist is refused" "got $CODE"

# Which project this board is for. Every board called itself "task-management" — the plugin's name,
# identical on all of them — so two open boards were indistinguishable except by port.
assert_contains "$(curl -fsS "http://127.0.0.1:$PORT/api/board")" '"project"' "the payload names the project"

# Board preferences live in the repo, not the browser. This is why notifications had to be
# switched on again in every browser: the preference was never about the browser.
CODE="$(post /api/settings '{"categories":["blocked"],"me":"ryan","grouped":true}')"
[[ "$CODE" == 200 ]] && ok "settings are writable over HTTP" || no "settings are writable" "got $CODE: $(body)"
assert_contains "$(curl -fsS "http://127.0.0.1:$PORT/api/board")" '"me":"ryan"' "the board payload carries them back"
assert_contains "$(cat "$STORE/config.json")" '"me": "ryan"' "and they are written to the repo's own config"
assert_contains "$(curl -fsS "http://127.0.0.1:$PORT/api/board")" '"actor"' "the payload names the session, for the profile menu"
# Policy keys are project-scoped and writable from the settings page (same as tm config).
CODE="$(post /api/settings '{"enforce":false,"wipLimit":99}')"
[[ "$CODE" == 200 ]] && ok "policy settings are writable over HTTP" || no "policy settings are writable over HTTP" "got $CODE: $(body)"
assert_contains "$(cat "$STORE/config.json")" '"enforce": false' "enforce is stored in the project config"
post /api/settings '{"enforce":true,"wipLimit":3}' >/dev/null
SETTINGS="$(curl -sS "http://127.0.0.1:$PORT/api/settings")"
case "$SETTINGS" in *'"groups"'*) ok "GET /api/settings returns the catalog" ;; *) no "GET /api/settings returns the catalog" "${SETTINGS:0:200}" ;; esac
assert_contains "$SETTINGS" "board.launchBrowser" "the catalog includes launch-browser"
# The board's identity is not a setting. The allowlist already keeps it out of reach; this asserts
# it, because "not currently writable" and "cannot be written" are different guarantees (TM-041).
CODE="$(post /api/settings '{"boardId":"acme/hijack"}')"
[[ "$CODE" == 400 ]] && ok "the dashboard cannot rewrite the board's identity" || no "the dashboard cannot rewrite the board's identity" "got $CODE"
case "$(cat "$STORE/config.json")" in
  *'acme/hijack'*) no "identity untouched on disk" "boardId was overwritten" ;;
  *) ok "identity untouched on disk" ;;
esac

post /api/settings '{"grouped":false,"nonsense":1}' >/dev/null
assert_contains "$(body)" '"ignored"' "an unknown key is named rather than silently stored"
CODE="$(post /api/settings '"nope"')"
[[ "$CODE" == 400 ]] && ok "a non-object settings body is refused" || no "a non-object settings body is refused" "got $CODE"

# Links write both ends; subtasks and rank move real fields.
post /api/task/TM-001/link '{"type":"blocks","to":"TM-002"}' >/dev/null
assert_contains "$(md TM-001)" '"blocks"' "a link is written on the near end"
assert_contains "$(md TM-002)" '"blocked by"' "a link is mirrored onto the far end"
post /api/task '{"title":"A child task","body":"subtask fixture","acceptance":["the parent is recorded"]}' >/dev/null
post /api/task/TM-003/subtask '{"parent":"TM-001"}' >/dev/null
assert_contains "$(md TM-003)" 'parent: "TM-001"' "a subtask records its parent"
CODE="$(post /api/task/TM-001/subtask '{"parent":"TM-001"}')"
[[ "$CODE" == 400 ]] && ok "a cyclic subtask is refused" || no "a cyclic subtask is refused" "got $CODE"
post /api/task/TM-003/rank '{"before":"TM-001"}' >/dev/null
assert_contains "$(md TM-003)" "rank:" "a drag writes a rank"
assert_contains "$(curl -fsS "$BASE/api/backlog")" "TM-003" "the backlog is served in order"

# BDM-68 — GET /api/templates must be wired here; handleWrite is only reached from POST/PATCH.
assert_contains "$(curl -fsS "$BASE/api/templates")" '"name":"bug"' "GET /api/templates lists store templates"
assert_contains "$(curl -fsS "$BASE/api/templates/bug")" "## Repro" "GET /api/templates/:name returns the file"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/templates/ghost")"
[[ "$CODE" == 404 ]] && ok "a missing template is 404" || no "a missing template is 404" "got $CODE"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/templates/..%2f..%2fetc")"
[[ "$CODE" == 400 ]] && ok "an unsafe template name is 400" || no "an unsafe template name is 400" "got $CODE"
CODE="$(post /api/task '{"title":"From a template","template":"bug"}')"
[[ "$CODE" == 201 ]] && ok "create with a template returns 201" || no "create with a template returns 201" "got $CODE: $(body)"
assert_contains "$(md TM-004)" "## Repro" "a templated create writes the skeleton body"
CODE="$(post /api/task '{"title":"Ghost","template":"ghost"}')"
[[ "$CODE" == 400 ]] && ok "an unknown template is 400 not a blank 201" || no "an unknown template is 400 not a blank 201" "got $CODE"

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

# ── W1: the CLI's reads and writes, over HTTP ────────────────────────────────
# Export is a computed document with a download disposition, never a file path.
EXPORT_HEAD="$(curl -fsS -D- -o "$TM_ROOT/board.csv" "$BASE/api/export?format=csv&download=1")"
assert_contains "$EXPORT_HEAD" "attachment" "csv export downloads"
assert_contains "$EXPORT_HEAD" "text/csv" "csv export is served as text/csv"
assert_contains "$(head -1 "$TM_ROOT/board.csv")" "Summary" "the csv carries Jira's header row"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/export?format=xml")"
[[ "$CODE" == 400 ]] && ok "an unknown export format is 400" || no "an unknown export format is 400" "got $CODE"

# find refuses a field that does not exist, naming the ones that do.
FIND="$(curl -s "$BASE/api/find?q=assigne:x")"
assert_contains "$FIND" "assignee" "an unknown find field is refused by name"
assert_contains "$(curl -fsS "$BASE/api/find?q=status:open")" "TM-001" "find answers tm find syntax over HTTP"

# Meta publishes the vocabulary; every other GET under /api reaches the pure handler.
assert_contains "$(curl -fsS "$BASE/api/meta")" '"findFields"' "GET /api/meta publishes the find fields"
assert_contains "$(curl -fsS "$BASE/api/skills")" '"/task-management:board"' "GET /api/skills lists the skill catalog"
assert_contains "$(curl -fsS "$BASE/api/task/TM-001/why")" '"startable"' "GET /api/task/:id/why answers"
assert_contains "$(curl -fsS "$BASE/api/graph")" '"mermaid"' "GET /api/graph draws"
assert_contains "$(curl -fsS "$BASE/api/doctor")" '"findings"' "GET /api/doctor reports"
NOPE="$(curl -s "$BASE/api/nope")"
assert_contains "$NOPE" '"error"' "an unknown /api path is a JSON 404, not the SPA shell"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/nope")"
[[ "$CODE" == 404 ]] && ok "an unknown /api path is 404" || no "an unknown /api path is 404" "got $CODE"

# The board carries a validator so a defensive refetch is a 304.
ETAG="$(curl -fsS -D- -o /dev/null "$BASE/api/board" | tr -d '\r' | awk -F': ' 'tolower($1)=="etag"{print $2}')"
[[ -n "$ETAG" ]] && ok "/api/board carries an ETag" || no "/api/board carries an ETag" "no etag header"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "If-None-Match: $ETAG" "$BASE/api/board")"
[[ "$CODE" == 304 ]] && ok "an unchanged board is a 304" || no "an unchanged board is a 304" "got $CODE"

# doctor --fix needs confirm; without it the file is untouched.
post /api/task '{"title":"Waits on a ghost","body":"doctor fixture","acceptance":["the dangling ref is repaired"]}' >/dev/null
post /api/task/TM-005/dep '{"add":["TM-404"]}' >/dev/null || true
node -e '
const fs=require("fs");const f=process.argv[1];const t=fs.readFileSync(f,"utf8").replace(/^blockedBy: .*$/m,"blockedBy: [\"TM-404\"]");fs.writeFileSync(f,t);
' "$(ls "$STORE"/tasks/TM-005-*.md)"
CODE="$(post /api/doctor/fix '{}')"
[[ "$CODE" == 400 ]] && ok "doctor fix without confirm is refused" || no "doctor fix without confirm is refused" "got $CODE"
assert_contains "$(md TM-005)" "TM-404" "the dangling ref survives an unconfirmed fix"
post /api/doctor/fix '{"confirm":true}' >/dev/null
case "$(md TM-005)" in *TM-404*) no "a confirmed fix drops the dangling ref" "still present" ;; *) ok "a confirmed fix drops the dangling ref" ;; esac

# Soft delete hides the card from the board and keeps the file.
post /api/task/TM-005/delete '{"why":"noise"}' >/dev/null
assert_contains "$(md TM-005)" 'status: "deleted"' "delete writes the status"
case "$(curl -fsS "$BASE/api/board")" in *'"TM-005"'*) no "a deleted task leaves the board" "still served" ;; *) ok "a deleted task leaves the board" ;; esac
post /api/task/TM-005/restore >/dev/null
assert_contains "$(md TM-005)" 'status: "open"' "restore brings it back"

# The create gate refuses a task with no context and no criteria, and says what is missing.
# Last, because nothing below numbers tasks: while the gate is unlanded this create succeeds
# and would shift every hardcoded TM- id above.
CODE="$(post /api/task '{"title":"Sparse create"}')"
[[ "$CODE" == 409 ]] && ok "a create with no body or criteria is refused" || no "a create with no body or criteria is refused" "got $CODE: $(body)"
assert_contains "$(body)" "body" "the refusal names the missing body"
assert_contains "$(body)" "acceptance" "the refusal names the missing criteria"
assert_contains "$(body)" "override" "the refusal names the escape hatch, as every gate does"

# ── planning sessions: propose, approve, apply, and the attachment rules ─────────────────────
CODE="$(post /api/planner '{"goal":"Add a preflight probe"}')"
[[ "$CODE" == 201 ]] && ok "a planning session opens" || no "a planning session opens" "got $CODE: $(body)"
PL="$(body | sed -n 's/.*"id": *"\(PL-[0-9a-f]*\)".*/\1/p')"
[[ -n "$PL" ]] && ok "the session has an id" || no "the session has an id" "$(body)"

BOARD_BEFORE="$(curl -fsS "$BASE/api/board" | grep -o '"id"' | wc -l)"
OPS='{"operations":[{"op":"epic.create","args":{"ref":"E","title":"Preflight","body":"why"}},{"op":"task.create","args":{"ref":"T","epic":"E","title":"Probe the agent","body":"context","acceptance":["it reports"]}}]}'
CODE="$(post "/api/planner/$PL/propose" "$OPS")"
[[ "$CODE" == 200 ]] && ok "a proposal previews" || no "a proposal previews" "got $CODE: $(body)"
assert_contains "$(body)" "independently reviewable epic" "the preview names the consequence, not the arguments"
DIGEST="$(body | sed -n 's/.*"digest": *"\([0-9a-f]*\)".*/\1/p')"
BOARD_AFTER_PREVIEW="$(curl -fsS "$BASE/api/board" | grep -o '"id"' | wc -l)"
[[ "$BOARD_BEFORE" == "$BOARD_AFTER_PREVIEW" ]] && ok "previewing writes nothing to the board" || no "previewing writes nothing to the board" "$BOARD_BEFORE -> $BOARD_AFTER_PREVIEW"

CODE="$(post "/api/planner/$PL/apply" '{"approvedDigest":"deadbeef"}')"
[[ "$CODE" == 409 ]] && ok "applying a digest nobody approved is refused" || no "applying a digest nobody approved is refused" "got $CODE: $(body)"
CODE="$(post "/api/planner/$PL/apply" "{\"approvedDigest\":\"$DIGEST\"}")"
[[ "$CODE" == 201 ]] && ok "the approved proposal applies" || no "the approved proposal applies" "got $CODE: $(body)"
assert_contains "$(curl -fsS "$BASE/api/board")" "Probe the agent" "and the task is on the board"
assert_contains "$(curl -fsS "$BASE/api/planner/$PL")" 'applied' "the session ends when its proposal lands"

# Attachments. Every rule is in lib/planner.mjs; this proves they are reachable over HTTP.
PL2="$(post /api/planner '{"goal":"Attach things"}' >/dev/null; body | sed -n 's/.*"id": *"\(PL-[0-9a-f]*\)".*/\1/p')"
printf '# notes\n' > "$TM_ROOT/notes.md"
printf '#!/bin/sh\nrm -rf /\n' > "$TM_ROOT/evil.sh"
UP="$(curl -s -o "$TM_ROOT/resp.json" -w '%{http_code}' -F "file=@$TM_ROOT/notes.md" "$BASE/api/planner/$PL2/attachment")"
[[ "$UP" == 201 ]] && ok "an allowed attachment uploads" || no "an allowed attachment uploads" "got $UP: $(body)"
assert_contains "$(body)" "untrusted-session-context" "and is recorded as untrusted context, not evidence"
SHA="$(body | sed -n 's/.*"sha256": *"\([0-9a-f]*\)".*/\1/p')"
UP="$(curl -s -o "$TM_ROOT/resp.json" -w '%{http_code}' -F "file=@$TM_ROOT/evil.sh" "$BASE/api/planner/$PL2/attachment")"
[[ "$UP" == 400 ]] && ok "a shell script is refused" || no "a shell script is refused" "got $UP: $(body)"
UP="$(curl -s -o "$TM_ROOT/resp.json" -w '%{http_code}' -F "file=@$TM_ROOT/evil.sh;filename=../../../../tmp/escaped.md" "$BASE/api/planner/$PL2/attachment")"
[[ ! -f /tmp/escaped.md ]] && ok "a traversing filename writes nothing outside the session" || no "a traversing filename writes nothing outside the session" "/tmp/escaped.md exists"

HEAD="$(curl -fsS -D- -o "$TM_ROOT/got.md" "$BASE/api/planner/$PL2/attachment/$SHA")"
assert_contains "$HEAD" "content-disposition: attachment" "an attachment is never rendered inline"
assert_contains "$HEAD" "sandbox" "and is served under a sandbox CSP, so it cannot borrow the origin"
assert_contains "$(cat "$TM_ROOT/got.md")" "notes" "the bytes round-trip"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/planner/$PL/attachment/$SHA")"
[[ "$CODE" == 404 ]] && ok "another session cannot read it" || no "another session cannot read it" "got $CODE"

# SSE: a fresh connect gets `ready`; Last-Event-ID: 0 replays the whole log with ids; idle streams ping.
(curl -sN --max-time 2 "$BASE/events" > "$TM_ROOT/sse-ready.txt" &) ; sleep 2.5
assert_contains "$(cat "$TM_ROOT/sse-ready.txt")" "event: ready" "a new subscriber is told it is ready"
(curl -sN --max-time 2 -H 'Last-Event-ID: 0' "$BASE/events" > "$TM_ROOT/sse-replay.txt" &) ; sleep 2.5
assert_contains "$(cat "$TM_ROOT/sse-replay.txt")" "event: store" "Last-Event-ID replays store frames"
assert_contains "$(cat "$TM_ROOT/sse-replay.txt")" "id: " "replayed frames carry ids"
assert_contains "$(cat "$TM_ROOT/sse-replay.txt")" '"event":"init"' "the replay starts from the beginning"
LAST="$(grep '^id: ' "$TM_ROOT/sse-replay.txt" | tail -1 | cut -d' ' -f2)"
(curl -sN --max-time 2 -H "Last-Event-ID: $LAST" "$BASE/events" > "$TM_ROOT/sse-caught-up.txt" &) ; sleep 2.5
case "$(cat "$TM_ROOT/sse-caught-up.txt")" in *"event: store"*) no "a caught-up client gets nothing replayed" "store frames replayed" ;; *) ok "a caught-up client gets nothing replayed" ;; esac
(curl -sN --max-time 2 -H 'Last-Event-ID: 999999999' "$BASE/events" > "$TM_ROOT/sse-resync.txt" &) ; sleep 2.5
assert_contains "$(cat "$TM_ROOT/sse-resync.txt")" "event: resync" "an id past the log asks the client to resync"

kill "$WRITE_PID" 2>/dev/null
wait_gone "$WRITE_PID"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
