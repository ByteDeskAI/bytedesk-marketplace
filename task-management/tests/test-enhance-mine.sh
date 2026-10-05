#!/usr/bin/env bash
# enhance-mine (TM-380): finds every known issue in a fixture transcript, never lets a planted
# secret reach output or the board, files nothing on a re-run, comments only on new evidence,
# and reports a missing source as skipped. Self-isolating: fresh TM_ROOT and HOME per run.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$PLUGIN_ROOT/tests/fixtures/enhance-mine-session.jsonl"
TM_ROOT="$(mktemp -d)"
HOME="$(mktemp -d)"
export TM_ROOT HOME
export CLAUDE_CODE_SESSION_ID="test-session"
unset TM_ENFORCE CLAUDE_PROJECT_DIR
trap 'rm -rf "$TM_ROOT" "$HOME"' EXIT

tm() { node "$PLUGIN_ROOT/bin/tm" "$@"; }
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected to contain: $2" ;; esac; }
lacks() { case "$1" in *"$2"*) no "$3" "must not contain: $2" ;; *) ok "$3" ;; esac; }
STORE="$TM_ROOT/.bytedesk/task-management"
items() { find "$STORE/tasks" "$STORE/capabilities" -name '*.md' 2>/dev/null | wc -l | tr -d ' '; }
comments() { cat "$STORE"/tasks/*.md "$STORE"/capabilities/*.md 2>/dev/null | grep -o 'enhance-mine: new evidence' | wc -l | tr -d ' '; }

echo "test-enhance-mine"
tm init >/dev/null
tm epic new "Mined work" --body "Where enhance-mine files bugs." >/dev/null

# ── coverage: a missing source is skipped, an empty window is not ──────────────
OUT="$(tm enhance-mine)"
has "$OUT" "transcripts  skipped: no transcript dir" "no transcript dir reports transcripts as skipped"
has "$OUT" "pool         skipped: no pool.log" "no pool.log reports pool as skipped"
has "$OUT" "tests        skipped: no --test-log given" "no test log reports tests as skipped"

SANITIZED="$(printf '%s' "$TM_ROOT" | tr '/.' '--')"
PROJ="$HOME/.claude/projects/$SANITIZED"
mkdir -p "$PROJ/sub/subagents"
cp "$FIXTURE" "$PROJ/sub/subagents/agent-fixture.jsonl"
# The planted token is assembled here, not committed, so secret scanning never sees a token shape.
TOKEN="gh""p_ABCDEFghijkl0123456789MNOPqrstuvWX99"
printf '{"type":"user","timestamp":"2026-10-01T10:18:30.000Z","message":{"role":"user","content":"still failing with token %s"}}\n' "$TOKEN" \
  >> "$PROJ/sub/subagents/agent-fixture.jsonl"
# TM-435: every secret shape the review found, planted twice (minCount 2) so each probe cluster is
# filed with its line as the sample. Lines stay under the 160-character sample cut, so an unredacted
# secret WOULD reach the board. Values are assembled here so no committed line looks like a credential.
B="Bea""rer"; A="Authori""zation"
PROBES=(
  "REDACT_PROBE_ONE: $A: $B bearerVAL9x $A: Basic basicVAL9x $A: token tokenVAL9x"
  "REDACT_PROBE_TWO: https://alice:urlPASS9x@example.com postgres://app:pgURL9x@db/x mysql -u root -pmysqlPW9x"
  "REDACT_PROBE_THREE: PGPASS=envVAL9x X=shortVAL9x curl -H '$B standaloneVAL9x'"
)
for line in "${PROBES[@]}" "${PROBES[@]}"; do
  printf '{"type":"user","timestamp":"2026-10-01T10:19:00.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tuR","is_error":true,"content":"Exit code 1\\n%s"}]}}\n' "$line" \
    >> "$PROJ/sub/subagents/agent-fixture.jsonl"
done
PLANTED=(bearerVAL9x basicVAL9x tokenVAL9x urlPASS9x pgURL9x mysqlPW9x envVAL9x shortVAL9x standaloneVAL9x)
touch -d '30 days ago' "$PROJ/sub/subagents/agent-fixture.jsonl"
OUT="$(tm enhance-mine)"
has "$OUT" "transcripts  0 file(s)" "an old transcript is scanned-and-empty, not skipped"
lacks "$OUT" "transcripts  skipped" "an empty window is distinguishable from a skipped source"
touch "$PROJ/sub/subagents/agent-fixture.jsonl"

# A hand-filed task that already describes known issue 1: the miner must comment, not re-file.
tm task new "TOPOLOGY_LAUNCH_FAILED error recurs" --body "Seen by hand." --ac "launch works" >/dev/null
# Board: a stale in-progress task.
tm config staleMinutes 0 >/dev/null
tm task new "Long running thing" --body "Stays open." --ac "it finishes" >/dev/null
tm start TM-002 >/dev/null 2>&1
sleep 1

# ── dry-run finds everything and writes nothing ────────────────────────────────
BEFORE="$(items)"
DRY="$(tm enhance-mine)"
for sig in "error-code:TOPOLOGY_LAUNCH_FAILED" "error-code:unknown_recipient" "tool-error:Bash: fatal not a git repository" \
           "workaround:tmux-send-keys" "user:repeating-myself" "board:stale-in-progress:TM-002"; do
  has "$DRY" "$sig" "dry-run finds $sig"
done
has "$DRY" "transcripts  1 file(s)" "the transcript is counted in coverage"
lacks "$DRY" "TOPOLOGY_SELFQUOTED_CODE" "enhance-mine never counts its own report output"
lacks "$DRY" "TOPOLOGY_SOURCE_CONSTANT_ONLY" "reading source code is not an occurrence of the codes it defines"
has "$DRY" "(1 bad lines)" "a partial line is tolerated and counted"
has "$DRY" "would comment TM-001" "the hand-filed task is matched, not re-filed"
lacks "$DRY" "user:stop-doing" "meta, sidechain and wrapper messages are not complaints"
lacks "$DRY" "user:feature-request" "a long task brief is not a complaint"
[[ "$(items)" == "$BEFORE" ]] && ok "dry-run writes nothing" || no "dry-run writes nothing" "$BEFORE -> $(items)"
[[ ! -e "$STORE/enhance-mine.json" ]] && ok "dry-run writes no state" || no "dry-run writes no state"

# ── apply ──────────────────────────────────────────────────────────────────────
A1="$(tm enhance-mine --apply)"
has "$A1" "filed task" "apply files bugs as tasks"
has "$A1" "filed CAP" "apply files enhancements as CAPs"
has "$A1" "commented TM-001" "apply comments on the matched hand-filed task"
has "$A1" "commented TM-002" "apply comments on the stale task"
lacks "$A1" "refused" "no filing was refused"
grep -q 'enhance-mine:error-code:unknown_recipient' "$STORE"/tasks/*.md && ok "the unknown_recipient task carries its signature" || no "the unknown_recipient task carries its signature"
grep -q 'enhance-mine:workaround:tmux-send-keys' "$STORE"/capabilities/*.md && ok "the workaround became a CAP" || no "the workaround became a CAP"
AFTER1="$(items)"
C1="$(comments)"

# ── secrets never reach output, state or the board ─────────────────────────────
ALL="$DRY$A1$(tm enhance-mine --json)$(cat "$STORE"/tasks/*.md "$STORE"/capabilities/*.md "$STORE/enhance-mine.json")"
lacks "$ALL" "hunter2SECRET" "a password in a tool result never reaches output or the board"
lacks "$ALL" "ghp_ABCDEF" "a GitHub token in a user message never reaches output or the board"
has "$ALL" "[REDACTED" "the redaction is visible where the secret was"
BOARD="$(cat "$STORE"/tasks/*.md "$STORE"/capabilities/*.md)"
for probe in REDACT_PROBE_ONE REDACT_PROBE_TWO REDACT_PROBE_THREE; do
  has "$BOARD" "$probe" "the $probe cluster reached the board (so its secrets could have)"
done
for secret in "${PLANTED[@]}"; do lacks "$ALL" "$secret" "TM-435: $secret never reaches output or the board"; done

# ── re-run: nothing new, nothing filed, nothing commented ──────────────────────
A2="$(tm enhance-mine --apply)"
[[ "$(items)" == "$AFTER1" ]] && ok "a re-run files 0 new items" || no "a re-run files 0 new items" "$AFTER1 -> $(items)"
[[ "$(comments)" == "$C1" ]] && ok "a re-run adds 0 comments" || no "a re-run adds 0 comments" "$C1 -> $(comments)"
lacks "$A2" "filed" "the re-run report files nothing"
has "$A2" "no new evidence" "the re-run report says why"

# ── new evidence: one comment on the matched item, nothing filed ───────────────
printf '%s\n' '{"type":"user","timestamp":"2026-10-04T09:00:00.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tuX","is_error":true,"content":"TOPOLOGY_LAUNCH_FAILED: again"}]}}' \
  >> "$PROJ/sub/subagents/agent-fixture.jsonl"
A3="$(tm enhance-mine --apply)"
[[ "$(items)" == "$AFTER1" ]] && ok "new evidence files nothing" || no "new evidence files nothing" "$AFTER1 -> $(items)"
[[ "$(comments)" == "$((C1 + 1))" ]] && ok "new evidence adds exactly one comment" || no "new evidence adds exactly one comment" "$C1 -> $(comments)"
has "$(cat "$STORE"/tasks/TM-001-*.md)" "1 occurrence(s)" "the comment counts only the new evidence"

# ── redaction unit checks ──────────────────────────────────────────────────────
RED="$(node --input-type=module -e "
import { redact } from '$PLUGIN_ROOT/lib/enhance-mine.mjs';
for (const s of ['api_key=sk-abcdefghijklmnop1234', 'xoxb-1234567890-abcdefghij', 'AKIAABCDEFGHIJKLMNOP',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N', 'the password is swordfish',
  'pwd tr0ub4dor', 'DB_PASSWORD: \"letmein\"', 'deadbeefdeadbeefdeadbeefdeadbeef00',
  'ZXhhbXBsZTEyM0FCQ2V4YW1wbGUxMjNBQkNleGFtcGxlMTIz']) console.log(redact(s));
console.log(redact('/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace stays'));")"
for s in sk-abcdef xoxb-1234 AKIAABCD eyJhbGci swordfish tr0ub4dor letmein deadbeef ZXhhbXBs; do
  lacks "$RED" "$s" "redact removes $s"
done
has "$RED" "bytedesk-marketplace stays" "redact leaves an ordinary path alone"

# TM-435 table: each shape must lose its whole value, not just a scheme word.
TABLE="$(node --input-type=module -e "
import { redact } from '$PLUGIN_ROOT/lib/enhance-mine.mjs';
const B = 'Bea' + 'rer';
const rows = [
  ['Authorization: ' + B + ' abcVAL9xyz', 'abcVAL9xyz'],
  ['authorization: \"' + B + ' quotedVAL9x\"', 'quotedVAL9x'],
  ['Authorization: Basic dXNlcjpwYXNz9x==', 'dXNlcjpwYXNz9x'],
  ['Authorization: token tokVAL9xyz', 'tokVAL9xyz'],
  ['curl -H \"X-Api: ' + B + ' bareVAL9xyz\"', 'bareVAL9xyz'],
  ['https://alice:httpPW9x@example.com/repo.git', 'httpPW9x'],
  ['postgres://app:pgPW9x@db:5432/app', 'pgPW9x'],
  ['redis://:onlyPW9x@cache:6379', 'onlyPW9x'],
  ['mysql -u root -pmyPW9x mydb', 'myPW9x'],
  ['PGPASSWORD=envPW9x psql', 'envPW9x'],
  ['X=shortPW9x', 'shortPW9x'],
  ['DEPLOY_KEY=deployPW9x make deploy', 'deployPW9x'],
  ['DB_PASSWORD: \"letmeinPW9x\"', 'letmeinPW9x'],
  ['the password is swordfishPW9x', 'swordfishPW9x'],
];
for (const [input, secret] of rows) console.log((redact(input).includes(secret) ? 'LEAK ' : 'ok ') + secret + ' -> ' + redact(input));
console.log('rows ' + rows.length);
console.log(redact('tmux capture-pane -p -t %3 and mkdir -p /tmp/x stay'));")"
[[ "$(grep -c '^ok ' <<<"$TABLE")" -ge 8 && "$TABLE" == *"rows 14"* ]] && ok "the redaction table ran 14 shapes" || no "the redaction table ran 14 shapes" "$TABLE"
lacks "$TABLE" "LEAK " "every shape in the table is fully redacted"
has "$TABLE" "capture-pane -p -t %3 and mkdir -p /tmp/x stay" "a bare -p flag is left alone"

echo "  $PASS passed, $FAIL failed"
[[ "$FAIL" == 0 ]]
