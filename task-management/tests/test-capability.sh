#!/usr/bin/env bash
# Capabilities: the discovery layer. Proposing, ranking, accepting into a task,
# and the evidence gate on shipping. Self-isolating: fresh TM_ROOT per run.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT
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

echo "test-capability"

tm init >/dev/null

# A capability needs no epic — proposing is not committing, so the task gate does not apply.
assert_contains "$(tm cap new 'Cheap big win' --area ux --impact H --effort S --confidence H)" "CAP-0001" "cap new mints CAP-0001"
tm cap new "Speculative rewrite" --area platform --impact H --effort L --confidence L >/dev/null

LIST="$(tm cap list)"
assert_contains "$LIST" "score 27" "impact x ease x confidence scores the cheap big win at 27"
assert_contains "$LIST" "score 3" "and the speculative rewrite at 3"
[[ "$(tm cap list | head -1)" == CAP-0001* ]] && ok "the backlog is ranked, best bet first" || no "the backlog is ranked" "$(tm cap list | head -1)"

# Bad sizes are refused rather than silently scored as medium.
tm cap new "Bad size" --impact XL >/dev/null 2>&1 && no "an invalid impact is refused" || ok "an invalid impact is refused"
tm cap new "Bad effort" --effort H >/dev/null 2>&1 && no "effort takes S/M/L, not H" || ok "effort takes S/M/L, not H"

# Accepting mints a task, so accept answers the task-create gate like `tm task new`
# (TM-077): an active epic first, then the card must carry the criteria the task is
# created with. Proposing stays ungated — it is not committing.
NOEPIC="$(tm cap accept CAP-0001 2>&1)"; RC=$?
[[ "$RC" == 2 ]] && ok "cap accept is refused without an active epic" || no "cap accept is refused without an active epic" "exit $RC"
assert_contains "$NOEPIC" "no active epic" "the refusal is the epic gate, the same as tm task new"

tm epic new "Build the wins" >/dev/null

NOAC="$(tm cap accept CAP-0001 2>&1)"; RC=$?
[[ "$RC" == 2 ]] && ok "a card without criteria is refused" || no "a card without criteria is refused" "exit $RC"
assert_contains "$NOAC" "- [ ]" "the refusal says to add criteria lines to the card"

# Accept mints the task and carries the card's acceptance criteria across as its gate.
tm edit CAP-0001 "Cheap big win" --body "## Acceptance criteria

- [ ] the palette lists help items
- [ ] no network call" >/dev/null
ACCEPT="$(tm cap accept CAP-0001)"
assert_contains "$ACCEPT" "TM-001" "accept mints the task"
assert_contains "$ACCEPT" "2 acceptance criteria carried over" "and carries the criteria across as its gate"
assert_contains "$(tm cap list)" "→ TM-001" "the capability names the task that builds it"
assert_contains "$(tm show TM-001)" "CAP-0001" "and the task names the capability that justifies it"
assert_contains "$(tm cap accept CAP-0001)" "already accepted" "accepting twice does not mint a second task"

# Shipping is gated on evidence, deliberately.
tm cap ship CAP-0001 >/dev/null 2>&1 && no "ship without evidence is refused" || ok "ship without evidence is refused"
echo "cutover PASS" | tm evidence CAP-0001 - >/dev/null
assert_contains "$(tm cap ship CAP-0001)" "shipped" "ship succeeds once there is evidence"
assert_contains "$(tm cap list --status "done")" "CAP-0001" "shipped capabilities are still queryable"

# The rest of the store knows about the new kind.
assert_contains "$(tm find 'Speculative')" "CAP-0002" "find searches capabilities"
assert_contains "$(tm reindex)" "2 capabilities" "reindex counts them"
assert_contains "$(tm log 50 --json)" '"cap-ship"' "shipping is on the timeline"

# Dropping is not deleting the record — the reasoning stays readable.
tm cap drop CAP-0002 "no evidence anyone wants this" >/dev/null
assert_contains "$(tm show CAP-0002)" "no evidence anyone wants this" "a dropped capability keeps its reason"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
