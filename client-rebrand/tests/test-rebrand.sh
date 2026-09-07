#!/usr/bin/env bash
# The gate, the digest, and the case file. Self-isolating: every run gets a fresh REBRAND_ROOT.
#
# No models and no network. The gate is the whole subject here, and none of it needs an agent —
# which is the point: the thing that decides whether a client's money gets spent on the next stage
# is testable on its own.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REBRAND_ROOT="$(mktemp -d)"
export REBRAND_ROOT
trap 'rm -rf "$REBRAND_ROOT"' EXIT

rebrand() { "$PLUGIN_ROOT/bin/rebrand" "$@"; }
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected to contain: $2" ;; esac }
hasnt() { case "$1" in *"$2"*) no "$3" "did not expect: $2" ;; *) ok "$3" ;; esac }

echo "test-rebrand"
echo
echo "== the case file"

OUT="$(rebrand new acme --name "Acme Surface Care" --input site=https://acme.test 2>&1)"
C="$REBRAND_ROOT/acme"
[ -f "$C/state.json" ] && ok "new creates a case file" || no "new creates a case file" "$OUT"
for d in 01-discovery 02-identity 03-direction 04-theme 05-brand 06-mockups runs; do
  [ -d "$C/$d" ] || no "new creates $d" "missing"
done
ok "new creates every stage folder"
has "$(cat "$C/state.json")" '"site": "https://acme.test"' "the brief passed at creation is kept"
# A case file that is not a repository has no record of what was approved when — the whole point of
# keeping deliverables beside their approval is being able to read the history back.
[ -d "$C/.git" ] && ok "the case file is a git repository" || no "the case file is a git repository"

OUT="$(rebrand new acme --name "Again" 2>&1)"; STATUS=$?
[ "$STATUS" -ne 0 ] && ok "a second new over the same slug is refused" || no "a second new over the same slug is refused"

OUT="$(rebrand new nameless 2>&1)"; STATUS=$?
[ "$STATUS" -ne 0 ] && ok "a client without a name is refused" || no "a client without a name is refused"

echo
echo "== the gate refuses, and says which of the four reasons applies"
# Every `next` here carries --dry-run. The refusals fire before the launch either way, but if one
# ever regressed, a test without it would start a real tmux team mid-suite.

OUT="$(rebrand status --client "$C" 2>&1)"
has "$OUT" "starts discovery" "status names the next stage when nothing has run"

# Stage 2 may not start before stage 1. Fake stage 2 having produced something, and confirm `next`
# still targets stage 1 rather than being fooled into skipping ahead by later work existing.
# --dry-run throughout: this suite must never actually start a tmux team.
echo "identity" > "$C/02-identity/IDENTITY.md"
OUT="$(rebrand next --dry-run --client "$C" 2>&1)"
has "$OUT" "Stage 1 — discovery" "next targets stage 1 even when a later stage has files"
hasnt "$OUT" "Stage 2" "and does not skip ahead to the stage that has files"
rm -f "$C/02-identity/IDENTITY.md"

printf 'brief\n' > "$C/01-discovery/brief.md"
printf 'audit\n' > "$C/01-discovery/audit.md"
python3 - "$C/state.json" <<'PY'
import json, sys
state = json.load(open(sys.argv[1]))
state["stages"]["discovery"]["status"] = "complete"
json.dump(state, open(sys.argv[1], "w"), indent=2)
PY

OUT="$(rebrand next --dry-run --client "$C" 2>&1)"; STATUS=$?
[ "$STATUS" -ne 0 ] && ok "next refuses a produced-but-unapproved stage" || no "next refuses a produced-but-unapproved stage"
has "$OUT" "nobody has approved" "and says so in those words"
has "$OUT" "rebrand approve discovery" "and gives the exact command that unblocks it"

OUT="$(rebrand approve discovery --client "$C" --by tester --note "fine" 2>&1)"
has "$OUT" "approved by tester" "approve records who"
has "$OUT" "sha256:" "and binds the approval to a digest"
RECORDED="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['stages']['discovery']['approval']['digest'])" "$C/state.json")"
has "$RECORDED" "sha256:" "the digest is stored in state.json"

echo
echo "== an approval that has drifted from what was approved is not an approval"

# The case this exists for: somebody edits a deliverable after sign-off. Nothing errors, no file is
# missing, and every name in the approval record still resolves — only the bytes differ.
printf 'brief, quietly edited after sign-off\n' > "$C/01-discovery/brief.md"
OUT="$(rebrand next --dry-run --client "$C" 2>&1)"; STATUS=$?
[ "$STATUS" -ne 0 ] && ok "next refuses after a deliverable changed" || no "next refuses after a deliverable changed" "$OUT"
has "$OUT" "Recorded:" "and shows the digest that was approved"
has "$OUT" "On disk:" "beside the one that is there now"
OUT="$(rebrand status --client "$C" 2>&1)"
has "$OUT" "APPROVED THEN CHANGED" "status reports the drift too, in the same terms"

# Adding a file counts: a stage's deliverable is the set, not any one file in it.
printf 'brief\n' > "$C/01-discovery/brief.md"
rebrand approve discovery --client "$C" --by tester >/dev/null 2>&1
printf 'extra\n' > "$C/01-discovery/EXTRA.md"
OUT="$(rebrand next --dry-run --client "$C" 2>&1)"; STATUS=$?
[ "$STATUS" -ne 0 ] && ok "adding a file to an approved stage also breaks the approval" || no "adding a file to an approved stage also breaks the approval"
rm -f "$C/01-discovery/EXTRA.md"

echo
echo "== a stage is complete only if its files are still there"

rebrand approve discovery --client "$C" --by tester >/dev/null 2>&1
mv "$C/01-discovery/brief.md" "$C/01-discovery/../brief.md.away"
mv "$C/01-discovery/audit.md" "$C/01-discovery/../audit.md.away"
OUT="$(rebrand status --client "$C" 2>&1)"
has "$OUT" "its folder is empty" "a stage marked complete with no files is reported incomplete"
mv "$C/brief.md.away" "$C/01-discovery/brief.md"
mv "$C/audit.md.away" "$C/01-discovery/audit.md"

echo
echo "== rejection keeps the round"

rebrand approve discovery --client "$C" --by tester >/dev/null 2>&1
OUT="$(rebrand reject discovery --client "$C" --why "the audit missed the old logo" 2>&1)"
has "$OUT" "sent back" "reject reports it"
# What was rejected and why is the most useful thing in a case file months later. Re-running over
# the top of it would erase exactly that.
[ -f "$C/01-discovery/brief.md" ] && ok "and the rejected round's files are kept" || no "and the rejected round's files are kept"
WHY="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['stages']['discovery']['rejected'][0]['why'])" "$C/state.json")"
has "$WHY" "missed the old logo" "the reason is recorded for the next round"
STATUS_AFTER="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['stages']['discovery']['status'])" "$C/state.json")"
[ "$STATUS_AFTER" = "pending" ] && ok "and the stage goes back to pending" || no "and the stage goes back to pending" "got $STATUS_AFTER"
OUT="$(rebrand reject discovery --client "$C" 2>&1)"; STATUS=$?
[ "$STATUS" -ne 0 ] && ok "a rejection without a reason is refused" || no "a rejection without a reason is refused"

OUT="$(rebrand approve discovery --client "$C" --by tester 2>&1)"; STATUS=$?
[ "$STATUS" -ne 0 ] && ok "a rejected stage cannot be re-approved without re-running it" \
  || no "a rejected stage cannot be re-approved without re-running it" "$OUT"

echo
echo "== the whole walk, six stages, no models"

# Every stage approved in turn, then the run is over. This is the shape an operator actually sees
# across days: produce, look, approve, next. Discovery is marked complete again first, because the
# rejection above put it back to pending and a pending stage is not approvable.
python3 - "$C/state.json" <<'PY'
import json, sys
state = json.load(open(sys.argv[1]))
state["stages"]["discovery"]["status"] = "complete"
json.dump(state, open(sys.argv[1], "w"), indent=2)
PY
rebrand approve discovery --client "$C" --by tester >/dev/null 2>&1
for stage in identity:02-identity direction:03-direction theme:04-theme brand:05-brand mockups:06-mockups; do
  name="${stage%%:*}"; folder="${stage##*:}"
  printf 'output of %s\n' "$name" > "$C/$folder/OUTPUT.md"
  python3 - "$C/state.json" "$name" <<'PY'
import json, sys
state = json.load(open(sys.argv[1]))
state["stages"][sys.argv[2]]["status"] = "complete"
json.dump(state, open(sys.argv[1], "w"), indent=2)
PY
  rebrand approve "$name" --client "$C" --by tester >/dev/null 2>&1
done
OUT="$(rebrand status --client "$C" 2>&1)"
has "$OUT" "All six stages approved." "status reports the finished case"
OUT="$(rebrand next --dry-run --client "$C" 2>&1)"
has "$OUT" "nothing left to run" "and next has nothing left to do"

echo
echo "== stage 6 takes its page set from what discovery found"

# The pages a client has are a finding, not a constant. `for_each` expands before any agent runs, so
# stage 6 cannot read the list itself — the driver reads discovery's pages.json and hands it in.
D="$REBRAND_ROOT/pageset"
rebrand new pageset --name "Page Set" >/dev/null 2>&1
for pair in discovery:01-discovery identity:02-identity direction:03-direction theme:04-theme brand:05-brand; do
  name="${pair%%:*}"; folder="${pair##*:}"
  printf 'x\n' > "$D/$folder/O.md"
  python3 - "$D/state.json" "$name" <<'PY'
import json, sys
state = json.load(open(sys.argv[1]))
state["stages"][sys.argv[2]]["status"] = "complete"
json.dump(state, open(sys.argv[1], "w"), indent=2)
PY
  rebrand approve "$name" --client "$D" --by tester >/dev/null 2>&1
done

OUT="$(rebrand next --dry-run --client "$D" 2>&1)"; STATUS=$?
[ "$STATUS" -ne 0 ] && ok "stage 6 refuses when discovery left no page set" || no "stage 6 refuses when discovery left no page set" "$OUT"
has "$OUT" "pages.json" "and names the file it wanted"
has "$OUT" "--input pages=" "and offers the manual way round it"

cat > "$D/01-discovery/pages.json" <<'JSON'
{"source": "existing", "pages": [
  {"slug": "home", "why": "where the estimate request starts"},
  {"slug": "services", "why": "the whole offer on one page"},
  {"slug": "contact", "why": "where a quote is actually requested"}]}
JSON
# Adding a file to an approved stage breaks its approval, correctly — in a real run discovery writes
# pages.json before anyone approves it. Re-approve to get past the gate this test is not about.
rebrand approve discovery --client "$D" --by tester >/dev/null 2>&1

OUT="$(rebrand next --dry-run --client "$D" 2>&1)"
has "$OUT" "home, services, contact" "the page set comes from discovery"
has "$OUT" "from 01-discovery/pages.json" "and says where it came from"

OUT="$(rebrand next --dry-run --client "$D" --input pages="just-one" 2>&1)"
hasnt "$OUT" "from 01-discovery/pages.json" "an explicit --input pages overrides the derivation"

# The cap belongs to the launcher; refusing here means the operator hears it with the list in hand
# rather than as TOPOLOGY_FANOUT_TOO_WIDE after committing to a run.
python3 - "$D/01-discovery/pages.json" <<'PY'
import json, sys
json.dump({"source": "proposed", "pages": [{"slug": f"p{n}"} for n in range(9)]},
          open(sys.argv[1], "w"))
PY
rebrand approve discovery --client "$D" --by tester >/dev/null 2>&1
OUT="$(rebrand next --dry-run --client "$D" 2>&1)"; STATUS=$?
[ "$STATUS" -ne 0 ] && ok "more pages than the fan-out cap is refused" || no "more pages than the fan-out cap is refused" "$OUT"
has "$OUT" "cap is 8" "and the refusal names the cap"

echo
echo "== resuming is reading a file, not restoring a process"

# The claim the whole design rests on: everything needed to continue is on disk, so a fresh process
# with no memory of the earlier ones reports the same thing.
OUT="$(env -u REBRAND_CLIENT "$PLUGIN_ROOT/bin/rebrand" status --client "$C" 2>&1)"
has "$OUT" "All six stages approved." "a brand new process picks the case up from state.json alone"
OUT="$(cd "$C" && "$PLUGIN_ROOT/bin/rebrand" status 2>&1)"
has "$OUT" "Acme Surface Care" "and standing inside the case file is enough to find it"

echo
echo "== summary"
echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
