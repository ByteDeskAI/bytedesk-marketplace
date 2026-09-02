#!/usr/bin/env bash
# Store + CLI behavior. Self-isolating: every run gets a fresh TM_ROOT.
# shellcheck disable=SC1010
# `done` is a tm verb (`tm done TM-001`), which shellcheck reads as the loop keyword.
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

# A host file another machine already committed must leave the index on the next
# init / session — ignore rules do nothing while git is still carrying the file.
HYG="$(mktemp -d)"
git -C "$HYG" init -q
git -C "$HYG" config user.email "t@example.com"
git -C "$HYG" config user.name "T"
git -C "$HYG" config commit.gpgsign false
mkdir -p "$HYG/.bytedesk/task-management"
printf '{}\n' > "$HYG/.bytedesk/task-management/events.jsonl"
printf 'readme\n' > "$HYG/README"
git -C "$HYG" add README .bytedesk/task-management/events.jsonl
git -C "$HYG" commit -qm init
TM_ROOT="$HYG" node "$PLUGIN_ROOT/bin/tm" init >/dev/null
[[ -f "$HYG/.bytedesk/task-management/events.jsonl" ]] && ok "untrack leaves events.jsonl on disk" || no "untrack leaves events.jsonl on disk"
TRACKED="$(git -C "$HYG" ls-files -- .bytedesk/task-management/events.jsonl)"
[[ -z "$TRACKED" ]] && ok "tm init untracks a committed events.jsonl" || no "tm init untracks a committed events.jsonl" "still tracked: $TRACKED"
git -C "$HYG" add -f .bytedesk/task-management/events.jsonl
git -C "$HYG" commit -qm retrack
echo '{}' | TM_ROOT="$HYG" "$PLUGIN_ROOT/hooks/tm-hook.sh" session-start >/dev/null
TRACKED2="$(git -C "$HYG" ls-files -- .bytedesk/task-management/events.jsonl)"
[[ -z "$TRACKED2" ]] && ok "session-start untracks a committed events.jsonl" || no "session-start untracks a committed events.jsonl" "still tracked: $TRACKED2"
git -C "$HYG" check-ignore -q .bytedesk/task-management/events.jsonl && ok "the store gitignore covers events.jsonl" || no "the store gitignore covers events.jsonl"
touch "$HYG/.bytedesk/task-management/dashboard.pid" "$HYG/.bytedesk/task-management/dashboard.port"
mkdir -p "$HYG/.bytedesk/worktrees/TM-001-x" "$HYG/.bytedesk/task-management/bin"
touch "$HYG/.bytedesk/worktrees/TM-001-x/x" "$HYG/.bytedesk/task-management/bin/tm"
git -C "$HYG" check-ignore -q .bytedesk/task-management/dashboard.pid && ok "the store gitignore covers dashboard.pid" || no "the store gitignore covers dashboard.pid"
git -C "$HYG" check-ignore -q .bytedesk/task-management/dashboard.port && ok "the store gitignore covers dashboard.port" || no "the store gitignore covers dashboard.port"
git -C "$HYG" check-ignore -q .bytedesk/worktrees/TM-001-x/x && ok "the parent gitignore covers worktrees" || no "the parent gitignore covers worktrees"
git -C "$HYG" check-ignore -q .bytedesk/task-management/bin/tm && ok "the store gitignore covers bin launchers" || no "the store gitignore covers bin launchers"
rm -rf "$HYG"

# Gate: no epic → TaskCreate path refuses (exit 2). The flags make this a complete
# draft, so the refusal can only be the missing epic.
assert_status 2 "task create denied without an active epic" tm task new "orphan task" --body "context" --ac "it exists"

tm epic new "Test epic" >/dev/null
assert_contains "$(tm epic)" "EP-001" "epic created and listed"
assert_contains "$(tm task new 'First real task' --body 'the task that proves creates work' --ac 'it is verifiably true')" "TM-001" "task created under the active epic"
assert_contains "$(cat "$TM_ROOT"/.bytedesk/task-management/tasks/TM-001-*.md)" 'epic: "EP-001"' "task carries the epic link"

# Duplicate guard — a complete draft again, so the gate passes and the guard is what refuses.
assert_status 2 "duplicate title is refused" tm task new "First real task" --body "context" --ac "it exists"
TM_ALLOW_DUP=1 tm task new "First real task" --body "context" --ac "it exists" >/dev/null && ok "TM_ALLOW_DUP bypasses the dup guard" || no "TM_ALLOW_DUP bypasses the dup guard"

# Acceptance criteria gate. Done also wants the details on the card: a body (carried
# from create), proof attached, and a name on the work — the create stamp is the actor.
tm ac TM-001 "a second criterion added after creation" >/dev/null
tm start TM-001 >/dev/null
assert_status 2 "done refused while acceptance criteria are unmet" tm done TM-001
tm accept TM-001 1 >/dev/null
tm accept TM-001 2 >/dev/null
echo "test output" | tm evidence TM-001 - >/dev/null
assert_status 0 "done allowed once criteria are met" tm done TM-001
assert_contains "$(tm board)" "1/2 done" "board counts completion"

# Dependencies
tm task new "Blocked work" --body "cannot start until the blocker lands" --ac "it unblocks" >/dev/null       # TM-003
tm task new "Blocker work" --body "the thing in the way" --ac "it clears" >/dev/null       # TM-004
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
tm task new "Typed subject alpha" --body "a subject for the type vocabulary" --ac "it reads its type" >/dev/null
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
tm task new "Dependency alpha subject" --body "the dependent half" --ac "it records its blocker" >/dev/null
tm task new "Dependency bravo subject" --body "the blocking half" --ac "it records the dependent" >/dev/null
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

SECOND=$(tm find "Second thing" --json | jq -r '.[-1].id')
assert_contains "$(tm show "$SECOND")" "blocked by" "the dependent goal is blocked by its dependency"
assert_contains "$(tm show "$SECOND")" "src/b.ts" "declared touches land on the task"
assert_contains "$(tm show "$SECOND")" "human-gate" "needsHumanGate becomes a label"
assert_contains "$(tm why "$SECOND")" "startable: no" "tm why answers for an imported program"

# tm reopen — the way back, and what it takes with it. The close needs the full set:
# ticked criteria, proof attached, body and actor from the create.
tm task new "Reopen target task" --body "will close, then come back" --ac "it is closed" >/dev/null
RID=$(tm find "Reopen target task" --json | jq -r '.[0].id')
tm accept "$RID" 1 >/dev/null; echo "reopen proof" | tm evidence "$RID" - >/dev/null; tm done "$RID" >/dev/null
tm task new "Still open on purpose" --body "stays open on purpose" --ac "never closes" >/dev/null
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

# BDM-66: `tm epic done` writes `closed`; `tm epic use` refuses a done epic (dashboard 409).
tm epic new "An epic to close" >/dev/null
CLOSE="$(tm find "An epic to close" --json | jq -r '.[0].id')"
tm epic done "$CLOSE" >/dev/null
assert_contains "$(tm show "$CLOSE" --json | jq -r .closed)" "T" "tm epic done writes closed"
assert_status 2 "tm epic use refuses a done epic" tm epic use "$CLOSE"
assert_contains "$(tm epic use "$CLOSE" 2>&1 || true)" "done — reopen" "the refusal names the same reason the dashboard 409 does"

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

# ── board identity is read-only when git supplies it (TM-041) ────────────────
# The value that gates cross-board writes must not be editable by the thing it is defending. With
# a remote configured, `tm config boardId` refuses and the file is left alone.
git -C "$TM_ROOT" remote remove origin 2>/dev/null || true
git -C "$TM_ROOT" remote add origin git@github.com:acme/identity-repo.git 2>/dev/null || \
  { git init -q "$TM_ROOT"; git -C "$TM_ROOT" remote add origin git@github.com:acme/identity-repo.git; }
assert_status 2 "tm config refuses to overwrite a git-derived boardId" node "$PLUGIN_ROOT/bin/tm" config boardId '"acme/hijack"'
assert_contains "$(tm config boardId '\"acme/hijack\"' 2>&1 || true)" "read-only" "and says why, naming what git reports"
AFTER_ID="$(node -e '
  const p = require("node:path").join(process.env.TM_ROOT, ".bytedesk/task-management/config.json");
  const c = JSON.parse(require("node:fs").readFileSync(p, "utf8"));
  console.log(c.boardId ?? "unset");
')"
[[ "$AFTER_ID" != "acme/hijack" ]] && ok "the refused write left the file alone" || no "the refused write left the file alone" "config now says $AFTER_ID"

# The person is recorded beside the board, and is read-only for the same reason (ADR-0002).
# A fresh store, because this store already recorded its owner at the top of the suite — and a
# board deliberately keeps the name of whoever set it up rather than re-labelling for each reader.
FRESH="$(mktemp -d)"
git init -q "$FRESH"
git -C "$FRESH" config user.name "Ada Lovelace"
git -C "$FRESH" config user.email "ada@example.com"
TM_ROOT="$FRESH" node "$PLUGIN_ROOT/bin/tm" init >/dev/null 2>&1
OWNER="$(node -e '
  const p = require("node:path").join(process.argv[1], ".bytedesk/task-management/config.json");
  console.log(JSON.parse(require("node:fs").readFileSync(p, "utf8")).owner ?? "unset");
' "$FRESH")"
[[ "$OWNER" == *"Ada Lovelace"* ]] && ok "tm init records who set the board up" || no "tm init records who set the board up" "owner is $OWNER"
rm -rf "$FRESH"
assert_status 2 "tm config refuses to overwrite a git-derived owner" node "$PLUGIN_ROOT/bin/tm" config owner '"Someone Else"'

# ── the create completeness gate (TM-077) ────────────────────────────────────
# An explicit create carries its details or is refused: no --body/--ac, no task.
# Self-contained at the end of the suite — by this point the store sits at the WIP
# limit with its last epic closed, and either would refuse these creates for reasons
# that are not the one under test.
tm epic new "Create gate coverage" >/dev/null
tm config wipLimit 99 >/dev/null
NEW_OUT="$(tm task new "no details at all" 2>&1)"; NEW_RC=$?
[[ "$NEW_RC" == 2 ]] && ok "task new without --body/--ac is refused" || no "task new without --body/--ac is refused" "exit $NEW_RC"
assert_contains "$NEW_OUT" "body" "the refusal names the missing body"
assert_contains "$NEW_OUT" "acceptance" "and the missing acceptance criteria"
NEW_OUT="$(tm task new "only a body" --body "context without criteria" 2>&1)"; NEW_RC=$?
[[ "$NEW_RC" == 2 ]] && ok "task new with --body but no --ac is refused" || no "task new with --body but no --ac is refused" "exit $NEW_RC"
assert_contains "$NEW_OUT" "acceptance" "the refusal still names the missing criteria"
assert_contains "$(tm task new "fully detailed task" --body "context and why" --ac "it works" --ac "it is tested")" "TM-" "task new with --body and --ac creates"
FULLID="$(tm find "fully detailed task" --json | jq -r '.[0].id')"
assert_contains "$(tm show "$FULLID")" "context and why" "the body lands on the task"
assert_contains "$(tm show "$FULLID" --json | jq -r '.acceptance | length')" "2" "both criteria land"
assert_contains "$(tm show "$FULLID" --json | jq -r '.acceptance[0].done')" "false" "criteria start unticked"
printf 'piped body\n' | tm task new "stdin bodied task" --body - --ac "it reads stdin" >/dev/null
PIPEID="$(tm find "stdin bodied task" --json | jq -r '.[0].id')"
assert_contains "$(tm show "$PIPEID")" "piped body" "--body - reads the body from stdin"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
