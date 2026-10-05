#!/usr/bin/env bash
# TM-361 — `tm review-sweep`: unreviewed finished tasks and idle open PRs, each fired exactly once.
#
# gh is a fake on PATH that records its argv and answers from a reply file, so the test asserts the
# exact call made and the clean-board coverage counts, not just a finding count.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
export TM_ROOT HOME="$TM_ROOT/home" CLAUDE_PROJECT_DIR="$TM_ROOT" CLAUDE_CODE_SESSION_ID="test-session"
mkdir -p "$HOME"
unset TM_ENFORCE TM_SESSION_ID
NODE="$(node -p 'process.execPath')"
SELF="$PLUGIN_ROOT/bin/tm"
trap 'rm -rf "$TM_ROOT"' EXIT
tm() { "$NODE" "$SELF" "$@"; }
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected: $2 | got: ${1:0:400}" ;; esac; }
# Evaluate a JS expression against a --json payload: `field 'r.fresh.length'`.
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }

echo "test-review-sweep"

FAKE="$TM_ROOT/fake"
mkdir -p "$FAKE"
export GH_LOG="$TM_ROOT/gh.argv" GH_REPLY="$TM_ROOT/gh.reply" GH_RC=0
cat > "$FAKE/gh" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$GH_LOG"
[[ "$GH_RC" == 0 ]] || { echo "error connecting to api.github.com" >&2; exit "$GH_RC"; }
cat "$GH_REPLY"
SH
chmod +x "$FAKE/gh"
export PATH="$FAKE:$PATH"

tm init >/dev/null
tm epic new "Sweep" >/dev/null

# ── a clean board: zero findings, with the coverage that proves it looked ─────────────
printf '[]\n' > "$GH_REPLY"
CLEAN="$(tm review-sweep --json)"; RC=$?
[[ $RC -eq 0 ]] && ok "review-sweep exits 0 on a clean board" || no "review-sweep exits 0 on a clean board" "rc=$RC"
[[ "$(echo "$CLEAN" | field 'r.findings.length')" == "0" ]] && ok "a clean board reports zero findings" || no "a clean board reports zero findings" "$CLEAN"
[[ "$(echo "$CLEAN" | field '[r.coverage.tasks,r.coverage.candidates,r.coverage.prs,r.coverage.prSource].join()')" == "0,0,0,gh" ]] \
  && ok "coverage names what was scanned (0 tasks, 0 candidates, 0 PRs from gh)" || no "coverage names what was scanned" "$CLEAN"
has "$(cat "$GH_LOG")" "pr list --state open --limit 100 --json number,title,url,headRefName,updatedAt,isDraft" "gh was asked for open PRs"

# ── the board: one unreviewed done task, one reviewed, one done without commits ─────
close() { tm accept "$1" 1 >/dev/null; echo "proof" | tm evidence "$1" - >/dev/null; tm done "$1" >/dev/null; }
# All three exist before any closes: closing the last open task auto-closes the epic.
T1="$(tm task new "Unreviewed" --body "context" --ac "done" | cut -d' ' -f1)"
T2="$(tm task new "Reviewed" --body "context" --ac "done" | cut -d' ' -f1)"
T3="$(tm task new "No commits" --body "context" --ac "done" | cut -d' ' -f1)"
tm link "$T1" abc1234 >/dev/null
tm link "$T2" def5678 >/dev/null
tm comment "$T2" "review verdict: approved by w-review" >/dev/null
for t in "$T1" "$T2" "$T3"; do close "$t"; done
OLD="$(node -e 'console.log(new Date(Date.now()-48*3600e3).toISOString())')"
NOW="$(node -e 'console.log(new Date().toISOString())')"
printf '[{"number":41,"title":"%s: idle work","url":"https://example/pull/41","headRefName":"tm/%s","updatedAt":"%s","isDraft":false},
{"number":42,"title":"fresh","url":"https://example/pull/42","headRefName":"x","updatedAt":"%s","isDraft":false},
{"number":43,"title":"draft","url":"https://example/pull/43","headRefName":"y","updatedAt":"%s","isDraft":true}]\n' "$T2" "$T2" "$OLD" "$NOW" "$OLD" > "$GH_REPLY"

DRY="$(tm review-sweep --json)"
[[ "$(echo "$DRY" | field 'r.findings.map(f=>f.key).sort().join()')" == "idle-pr:41:$OLD,no-review:$T1" ]] \
  && ok "finds the unreviewed task and the idle PR, nothing else" || no "finds the unreviewed task and the idle PR, nothing else" "$DRY"
[[ "$(echo "$DRY" | field 'r.coverage.candidates')" == "2" ]] && ok "coverage counts the two finished tasks with commits" || no "coverage counts the two finished tasks with commits" "$DRY"
[[ "$(echo "$DRY" | field 'r.findings.find(f=>f.kind==="idle-pr").id')" == "$T2" ]] && ok "the idle PR is tied to its task" || no "the idle PR is tied to its task" "$DRY"
[[ ! -e "$TM_ROOT/.bytedesk/task-management/review-sweep.json" ]] && ok "without --apply nothing is marked" || no "without --apply nothing is marked"

# ── --apply fires each finding once ───────────────────────────────────────────────────
APPLY="$(tm review-sweep --apply --json)"
[[ "$(echo "$APPLY" | field 'r.fresh.length')" == "2" ]] && ok "the first --apply fires both findings" || no "the first --apply fires both findings" "$APPLY"
has "$(tm show "$T1" --json)" "review-sweep: $T1 is done with commits and no reviewer verdict" "the unreviewed task carries the notice"
AGAIN="$(tm review-sweep --apply --json)"
[[ "$(echo "$AGAIN" | field '[r.findings.length, r.fresh.length, r.findings.every(f=>f.notified)].join()')" == "2,0,true" ]] \
  && ok "a second --apply fires nothing (exactly once)" || no "a second --apply fires nothing (exactly once)" "$AGAIN"
[[ "$(tm show "$T1" --json | grep -o 'review-sweep:' | wc -l | tr -d ' ')" == "1" ]] && ok "one comment, not two" || no "one comment, not two"

# A PR that moved and went idle again is a new episode.
OLDER="$(node -e 'console.log(new Date(Date.now()-30*3600e3).toISOString())')"
sed -i "s/$OLD/$OLDER/" "$GH_REPLY"
[[ "$(tm review-sweep --apply --json | field 'r.fresh.join()')" == "idle-pr:41:$OLDER" ]] && ok "a PR idle again after activity fires again" || no "a PR idle again after activity fires again"

# ── offline: the PR half is skipped by name, the task half still runs ─────────────────
OFF="$(GH_RC=1 tm review-sweep --json)"; RC=$?
[[ $RC -eq 0 ]] && has "$(echo "$OFF" | field 'r.coverage.prSource')" "skipped: gh pr list exited 1" "offline gh is skipped by name, exit 0" || no "offline gh is skipped" "rc=$RC $OFF"
[[ "$(echo "$OFF" | field 'r.findings.map(f=>f.key).join()')" == "no-review:$T1" ]] && ok "offline still reports task findings" || no "offline still reports task findings" "$OFF"

echo
echo "$PASS passed, $FAIL failed"
(( FAIL == 0 ))
