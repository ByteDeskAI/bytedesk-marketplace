#!/usr/bin/env bash
# Store + CLI behavior. Self-isolating: every run gets a fresh TM_ROOT.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT
# The name Claude Code actually sets. The suites used to export CLAUDE_SESSION_ID, which
# nothing sets — so every session-dependent path was exercised with a variable production
# never had, and 9 suites stayed green while claims, gates and attribution were all inert.
export CLAUDE_CODE_SESSION_ID="test-session"
unset TM_ENFORCE
trap 'rm -rf "$TM_ROOT"' EXIT

tm() { node "$PLUGIN_ROOT/bin/tm" "$@"; }
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

echo "test-store"

tm init >/dev/null
[[ -d "$TM_ROOT/.bytedesk/task-management/tasks" ]] && ok "init creates the store" || no "init creates the store"

# A store the repo ignores never reaches a second clone, and nothing else ever says so:
# git status stays clean and the board works. init has to name it at creation.
IGN="$(mktemp -d)"
git init -q "$IGN" && printf '.bytedesk/\n' > "$IGN/.gitignore"
INIT_ERR="$(cd "$IGN" && TM_ROOT="$IGN" node "$PLUGIN_ROOT/bin/tm" init 2>&1 >/dev/null)"
assert_contains "$INIT_ERR" "ignored by git" "init warns when the repo would swallow the store"
assert_contains "$INIT_ERR" ".gitignore:1:.bytedesk/" "the warning names the rule to edit"
rm -rf "$IGN"

# Gate: no epic → TaskCreate path refuses (exit 2)
assert_status 2 "task create denied without an active epic" tm task new "orphan task"

tm epic new "Test epic" >/dev/null
assert_contains "$(tm epic)" "EP-001" "epic created and listed"
assert_contains "$(tm task new 'First real task')" "TM-001" "task created under the active epic"
assert_contains "$(cat "$TM_ROOT"/.bytedesk/task-management/tasks/TM-001-*.md)" 'epic: "EP-001"' "task carries the epic link"

# Duplicate guard
assert_status 2 "duplicate title is refused" tm task new "First real task"
TM_ALLOW_DUP=1 tm task new "First real task" >/dev/null && ok "TM_ALLOW_DUP bypasses the dup guard" || no "TM_ALLOW_DUP bypasses the dup guard"

# Acceptance criteria gate
tm ac TM-001 "the thing is verifiably true" >/dev/null
tm start TM-001 >/dev/null
assert_status 2 "done refused while acceptance criteria are unmet" tm done TM-001
tm accept TM-001 1 >/dev/null
assert_status 0 "done allowed once criteria are met" tm done TM-001
assert_contains "$(tm board)" "1/2 done" "board counts completion"

# Dependencies
tm task new "Blocked work" >/dev/null       # TM-003
tm task new "Blocker work" >/dev/null       # TM-004
tm dep TM-003 TM-004 >/dev/null
assert_contains "$(tm board)" "blocked-by TM-004" "dependency recorded"
case "$(tm next)" in *TM-003*) no "next hides blocked tasks" "TM-003 should not be next" ;; *) ok "next hides blocked tasks" ;; esac

# WIP limit
tm config wipLimit 1 >/dev/null
tm start TM-004 >/dev/null
assert_status 2 "WIP limit blocks a second in-progress task" tm start TM-003
tm override "testing the escape hatch" >/dev/null
assert_status 0 "override releases exactly one gate" tm start TM-003
assert_status 2 "override is one-shot" tm start TM-002
tm config wipLimit 3 >/dev/null

# Enforcement kill switch
assert_status 0 "TM_ENFORCE=off opens every gate" env TM_ENFORCE=off node "$PLUGIN_ROOT/bin/tm" task new "First real task"

# Evidence + git-style linkage
echo "log output" | tm evidence TM-003 - >/dev/null
assert_contains "$(tm handoff TM-003)" "Evidence" "evidence attaches to the task"
tm link TM-003 abc1234 >/dev/null
assert_contains "$(tm handoff TM-003)" "abc1234" "commit refs attach to the task"

# Index is a derived cache
BEFORE="$(tm board)"
rm "$TM_ROOT/.bytedesk/task-management/index.json"
tm reindex >/dev/null
[[ "$BEFORE" == "$(tm board)" ]] && ok "board survives losing index.json" || no "board survives losing index.json"

# tm goal import — a goal's own success criteria become the gate that closes it.
GDOC="$TM_ROOT/goal-fixture.md"
cat > "$GDOC" <<'GOALDOC'
# Goal: Bake the harness into the image (BDP-2003)

**Success criteria (verifiable):**
- the binary resolves on PATH inside the built image
1. a new versioned tag is pushed, never :latest
GOALDOC
OUT="$(tm goal import "$GDOC")"
assert_contains "$OUT" "Bake the harness into the image" "goal import names the task from the # Goal: heading"
assert_contains "$OUT" "2 acceptance" "goal import reads both dash and numbered criteria"
GID=$(tm find "Bake the harness" --json | jq -r '.[0].id')
assert_contains "$(tm show "$GID")" "resolves on PATH" "the goal's criteria became acceptance criteria"
assert_contains "$(tm show "$GID")" "BDP-2003" "the Jira key is kept"
assert_status 2 "tm done refuses using the goal's own criteria" node "$PLUGIN_ROOT/bin/tm" done "$GID"

# A doc with no criteria must be refused, not imported with an empty gate.
cat > "$TM_ROOT/no-criteria.md" <<'GOALDOC'
# Goal: A goal nobody wrote criteria for

## Why
Because.
GOALDOC
assert_status 2 "goal import refuses a doc with no parseable criteria" node "$PLUGIN_ROOT/bin/tm" goal import "$TM_ROOT/no-criteria.md"
assert_contains "$(tm goal import "$TM_ROOT/no-criteria.md" 2>&1 || true)" "certify a goal nobody verified" "the refusal says why it matters"
BEFORE=$(tm board --json | jq '.tasks | length')
tm goal import "$TM_ROOT/no-criteria.md" >/dev/null 2>&1 || true
[[ "$(tm board --json | jq '.tasks | length')" == "$BEFORE" ]] && ok "a refused import creates nothing" || no "a refused import creates nothing"

# tm type — the vocabulary, and the derivation that keeps old stores reading correctly.
tm task new "Typed subject alpha" >/dev/null
TID=$(tm find "Typed subject alpha" --json | jq -r '.[0].id')
assert_contains "$(tm type "$TID")" "type: task (derived)" "an untyped task reads as task, and says it was derived"
assert_contains "$(tm type "$TID" bug)" "type: bug" "tm type sets the field"
assert_status 2 "tm type refuses a value outside the vocabulary" node "$PLUGIN_ROOT/bin/tm" type "$TID" epic
assert_contains "$(tm export csv | grep "^$TID,")" ",Bug," "the CSV Issue Type column reports the real type"
tm label "$TID" -bug >/dev/null 2>&1 || true
tm type "$TID" "" >/dev/null
tm label "$TID" spike >/dev/null
assert_contains "$(tm type "$TID")" "type: spike (derived)" "a type worn as a label still reads, so existing stores need no migration"

# tm dep — a leading dash removes, matching tm label. Removal did not exist before.
tm task new "Dependency alpha subject" >/dev/null
tm task new "Dependency bravo subject" >/dev/null
DA=$(tm find "Dependency alpha subject" --json | jq -r '.[0].id')
DB=$(tm find "Dependency bravo subject" --json | jq -r '.[0].id')
assert_contains "$(tm dep "$DA" "$DB")" "blocked by $DB" "tm dep adds a blocker"
assert_contains "$(tm show "$DB")" "blocks" "the other end of the edge is written"
assert_contains "$(tm log "$DA" --json)" '"event": "dep"' "adding a dependency logs an event"
assert_status 2 "tm dep refuses a cycle rather than leaving it for doctor" node "$PLUGIN_ROOT/bin/tm" dep "$DB" "$DA"
assert_status 2 "tm dep refuses a self-dependency" node "$PLUGIN_ROOT/bin/tm" dep "$DA" "$DA"
assert_contains "$(tm dep "$DA" "-$DB")" "blocked by (nothing)" "a leading dash removes a blocker"
assert_contains "$(tm log "$DA" --json)" '"event": "undep"' "removing a dependency logs an event"
case "$(tm show "$DB")" in
  *"blocks: $DA"*) no "removal clears the other end" "still lists blocks" ;;
  *) ok "removal clears the other end" ;;
esac
json "$(tm dep "$DA" --json)" 'type == "array"' "tm dep with no args reads the blockers"

# A manifest import: one epic, a task per goal, the manifest's deps and its declared touches.
mkdir -p "$TM_ROOT/g"
cat > "$TM_ROOT/g/one.md" <<'GD'
# Goal: First thing (BDP-1)
**Success criteria (verifiable):**
- the first thing is true
GD
cat > "$TM_ROOT/g/two.md" <<'GD'
# Goal: Second thing (BDP-2)
## Success criteria
1. the second thing is true
GD
cat > "$TM_ROOT/g/nocrit.md" <<'GD'
# Goal: Third thing with no criteria
## Why
Because.
GD
cat > "$TM_ROOT/g/p.plan.json" <<'MF'
{ "plan": "demo", "epic": { "title": "Demo Program", "definitionOfDone": "all three land" },
  "integration": { "gate": "make ci" },
  "goals": [
    { "id": "one", "doc": "one.md", "title": "First thing", "dependsOn": [], "touches": ["src/a.ts"], "mode": "parallel", "needsHumanGate": false },
    { "id": "two", "doc": "two.md", "title": "Second thing", "dependsOn": ["one"], "touches": ["src/b.ts"], "mode": "sequential", "needsHumanGate": true },
    { "id": "three", "doc": "nocrit.md", "title": "Third thing", "dependsOn": ["one"], "touches": [], "mode": "parallel", "needsHumanGate": false }
  ] }
MF
OUT="$(tm goal import "$TM_ROOT/g/p.plan.json" 2>&1 || true)"
assert_contains "$OUT" "Demo Program" "a manifest import opens the epic"
assert_contains "$OUT" "2 task(s) from 3 goal(s)" "each goal with parseable criteria becomes a task"
assert_contains "$OUT" "1 dependency edge" "dependsOn becomes a tm dependency"
assert_contains "$OUT" "carry declared touches" "the manifest's touches populate the field tm parallel batches on"
assert_contains "$OUT" "integration gate: make ci" "the integration gate is surfaced"
assert_contains "$OUT" "nocrit.md" "a goal with no parseable criteria is named, not silently dropped"
assert_status 2 "a manifest with a skipped goal exits 2 so a script notices" node "$PLUGIN_ROOT/bin/tm" goal import "$TM_ROOT/g/p.plan.json"

MEPIC=$(tm epic | tail -1 | grep -oE 'EP-[0-9]+')
SECOND=$(tm find "Second thing" --json | jq -r '.[-1].id')
assert_contains "$(tm show "$SECOND")" "blocked by" "the dependent goal is blocked by its dependency"
assert_contains "$(tm show "$SECOND")" "src/b.ts" "declared touches land on the task"
assert_contains "$(tm show "$SECOND")" "human-gate" "needsHumanGate becomes a label"
assert_contains "$(tm why "$SECOND")" "startable: no" "tm why answers for an imported program"

# tm reopen — the way back, and what it takes with it.
tm task new "Reopen target task" >/dev/null
RID=$(tm find "Reopen target task" --json | jq -r '.[0].id')
tm ac "$RID" "it is closed" >/dev/null; tm accept "$RID" 1 >/dev/null; tm done "$RID" >/dev/null
tm task new "Still open on purpose" >/dev/null
OPENID=$(tm find "Still open on purpose" --json | jq -r '.[0].id')
assert_status 2 "reopen refuses a task that is not done" node "$PLUGIN_ROOT/bin/tm" reopen "$OPENID"
assert_contains "$(tm reopen "$RID" changed my mind)" "reopened" "reopen brings a done task back"
assert_contains "$(tm show "$RID")" "changed my mind" "reopen records why"
case "$(tm show "$RID" --json)" in
  *'"closed"'*) no "reopen clears the closed date" "closed is still in the record" ;;
  *) ok "reopen clears the closed date" ;;
esac
tm done "$RID" >/dev/null 2>&1 || true
assert_contains "$(tm start "$RID" 2>&1)" "reopened from done" "start on a done task says it reopened"

# tm doctor — the exit code is the contract: it is meant to gate a commit or a CI step.
assert_status 0 "doctor exits 0 on a healthy store" node "$PLUGIN_ROOT/bin/tm" doctor
STORE="$TM_ROOT/.bytedesk/task-management"
sed -i 's/^blockedBy: .*/blockedBy: ["TM-404"]/' "$STORE"/tasks/TM-003-*.md
assert_status 1 "doctor exits 1 on an error-level finding" node "$PLUGIN_ROOT/bin/tm" doctor
assert_contains "$(tm doctor || true)" "TM-404" "doctor names the broken reference"
assert_contains "$(tm doctor --fix)" "dropped TM-404" "doctor --fix says what it changed"
assert_status 0 "and the store is clean afterwards" node "$PLUGIN_ROOT/bin/tm" doctor

# Event log
assert_contains "$(tm log 100 --json)" '"event": "done"' "events are logged"
assert_contains "$(tm standup 2000-01-01T00:00:00Z)" "TM-001" "standup reads the event log"

# edit / move — the two fields `new` writes, and the epic nothing could change.
# The gates are not what is under test here, and by this point the suite is sitting at the WIP
# limit (3/3 in progress), so the fixture is created the way line 71 does it.
tm epic new "An epic to correct things in" >/dev/null
env TM_ENFORCE=off node "$PLUGIN_ROOT/bin/tm" task new "typoed titel" >/dev/null
EDITID="$(tm find "typoed titel" --json | jq -r '.[0].id')"
EDITFILE="$(tm show "$EDITID" --json | jq -r .file)"
assert_contains "$(tm edit "$EDITID" "the corrected title")" 'was "typoed titel"' "edit reports what the title was"
assert_contains "$(tm show "$EDITID")" "the corrected title" "the correction is stored"
assert_contains "$(tm edit "$EDITID" "the corrected title")" "unchanged" "re-typing the same title is not a write"
[[ "$(tm show "$EDITID" --json | jq -r .file)" == "$EDITFILE" ]] \
  && ok "a retitle keeps the file name, so git blame survives" \
  || no "a retitle keeps the file name" "file moved to $(tm show "$EDITID" --json | jq -r .file)"
printf '## Notes\nfrom a pipe\n' | tm edit "$EDITID" --body - >/dev/null
assert_contains "$(tm show "$EDITID")" "from a pipe" "--body - reads the body from stdin"
tm edit "$EDITID" 2>/dev/null && no "edit with nothing to change is refused" || ok "edit with nothing to change is refused"

tm epic new "A destination epic" >/dev/null
DEST="$(tm find "A destination epic" --json | jq -r '.[0].id')"
assert_contains "$(tm move "$EDITID" "$DEST")" "moved" "move refiles under another epic"
assert_contains "$(tm show "$EDITID" --json | jq -r .epic)" "$DEST" "the new epic is stored"
assert_contains "$(tm move "$EDITID" "$DEST")" "already" "moving where it already is says so"
assert_contains "$(tm move "$EDITID" none)" "(no epic)" "none detaches it"
tm move "$EDITID" EP-404 2>/dev/null && no "a move to a missing epic is refused" || ok "a move to a missing epic is refused"
tm move "$EDITID" "$EDITID" 2>/dev/null && no "a move to a non-epic id is refused" || ok "a move to a non-epic id is refused"
assert_contains "$(tm log 200 --json)" '"event": "moved"' "the move is on the timeline, with where it came from"

# Acceptance criteria: tick, untick, remove. The gate `tm done` reads must not be one-way.
env TM_ENFORCE=off node "$PLUGIN_ROOT/bin/tm" task new "the gated one" >/dev/null
GID="$(tm find "the gated one" --json | jq -r '.[0].id')"
tm ac "$GID" "the tickable one" >/dev/null
tm ac "$GID" "the typo'd one" >/dev/null
assert_contains "$(tm accept "$GID" 1)" "AC 1 met (1/2)" "accept ticks"
assert_contains "$(tm accept "$GID" 1 --undo)" "AC 1 unmet (0/2)" "--undo unticks"
RM="$(tm ac "$GID" --rm 2)"
assert_contains "$RM" "removed: the typo'd one" "--rm removes it"
assert_contains "$RM" "1. [ ] the tickable one" "and prints the surviving list, because removal renumbers"
tm accept "$GID" 9 >/dev/null 2>&1 && no "a bad criterion index is refused" || ok "a bad criterion index is refused"
assert_contains "$(tm log 200 --json)" '"event": "ac_unmet"' "an untick is on the timeline"

# Sprints — the thing that gives `estimate` a reader.
tm sprint new "Sprint 12" --ends 2026-08-14 >/dev/null
env TM_ENFORCE=off node "$PLUGIN_ROOT/bin/tm" task new "a committed card" >/dev/null
SPT="$(tm find "a committed card" --json | jq -r '.[0].id')"
tm estimate "$SPT" 5 >/dev/null
tm sprint add "$SPT" >/dev/null
assert_contains "$(tm sprint)" "0/5 points done" "the sprint report totals committed points"
assert_contains "$(tm find sprint:SP-001)" "$SPT" "sprint: finds what is committed"
tm sprint add TM-404 >/dev/null 2>&1 && no "committing a task that does not exist is refused" || ok "committing a task that does not exist is refused"
assert_contains "$(tm sprint list)" "SP-001" "sprint list shows it"
assert_contains "$(tm sprint done)" "unfinished, still on the board" "closing a sprint does not evaporate unfinished work"
assert_contains "$(tm log 200 --json)" '"event": "sprint"' "sprint changes are on the timeline"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
