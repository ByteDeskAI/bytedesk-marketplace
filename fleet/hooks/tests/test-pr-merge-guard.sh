#!/usr/bin/env bash
# Test fixture for .claude/hooks/pr-merge-guard.sh.
#
# Exercises the depth-aware authorization model defined in
# docs/architecture/adr/0046-hierarchical-fleet-authorization.md and the
# command-form coverage that BDP-367's review identified as gaps.
#
# Run: bash .claude/hooks/tests/test-pr-merge-guard.sh
#
# Each case constructs a JSON payload + transcript, pipes the payload through
# the hook, and asserts the resulting exit code matches the expectation.

set -u  # don't `-e` — we want to keep running after test failures

HOOK="$(cd "$(dirname "$0")/.." && pwd)/pr-merge-guard.sh"
[[ -x "$HOOK" ]] || { echo "FAIL: hook not executable at $HOOK" >&2; exit 1; }

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

PASS=0
FAIL=0

# Build a transcript file with one user message (string content) and exit.
make_transcript() {
  local content="$1"
  local file="$TMPDIR/transcript-$$-$RANDOM.jsonl"
  jq -nc --arg c "$content" '{type:"user", message:{content:$c}}' >"$file"
  echo "$file"
}

# Build an empty transcript (only tool-result records, no real user input).
make_empty_transcript() {
  local file="$TMPDIR/transcript-$$-$RANDOM.jsonl"
  jq -nc '{type:"user", message:{content:[{type:"tool_result", content:"x"}]}}' >"$file"
  echo "$file"
}

# Run the hook with a constructed payload and depth env var.
# Args: name, expected_exit_code, depth, command, transcript_path
run_case() {
  local name="$1" expected="$2" depth="$3" command="$4" transcript="$5"
  local payload
  payload="$(jq -nc \
    --arg cmd "$command" \
    --arg t "$transcript" \
    '{tool_name:"Bash", tool_input:{command:$cmd}, transcript_path:$t}')"

  local actual=0
  CLAUDE_SESSION_DEPTH="$depth" "$HOOK" <<<"$payload" >/dev/null 2>&1 || actual=$?

  if [[ "$actual" == "$expected" ]]; then
    printf '  \e[32mPASS\e[0m %s (depth=%s, exit=%s)\n' "$name" "$depth" "$actual"
    PASS=$((PASS+1))
  else
    printf '  \e[31mFAIL\e[0m %s (depth=%s, expected=%s, got=%s)\n' "$name" "$depth" "$expected" "$actual"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Pass-through (non-merge commands) ==="
T_EMPTY="$(make_transcript "anything")"
run_case "non-merge gh pr view"         0 0 'gh pr view 99999' "$T_EMPTY"
run_case "unrelated bash"                0 0 'echo hello'        "$T_EMPTY"
run_case "merge in echo (substring)"     0 0 'echo "gh pr mergeplaceholder"' "$T_EMPTY"

echo
echo "=== Depth 0 — explicit PR# in command + user message authorization ==="
T_OK="$(make_transcript "merge #346 please")"
run_case "explicit + #N in msg"          0 0 'gh pr merge 346'                "$T_OK"
run_case "explicit + flag-suffix"        0 0 'gh pr merge 346 --squash'       "$T_OK"
run_case "explicit + body suffix"        0 0 'gh pr merge 346 --body "ship"'  "$T_OK"
run_case "merge N pattern"               0 0 'gh pr merge 346' "$(make_transcript "merge 346 now")"
run_case "PR N pattern"                  0 0 'gh pr merge 346' "$(make_transcript "PR 346 ready")"
run_case "pull/N pattern"                0 0 'gh pr merge 346' "$(make_transcript "https://github.com/x/y/pull/346")"

echo
echo "=== Depth 0 — bypass forms still blocked (regression test for BDP-367 review) ==="
# T_VAGUE has no PR# AND no "merge" word → both STRICT and BARE paths block.
T_VAGUE="$(make_transcript "ship it")"
run_case "flag-before-number --squash"   2 0 'gh pr merge --squash 346'   "$T_VAGUE"
run_case "flag-before-number --rebase"   2 0 'gh pr merge --rebase 346'   "$T_VAGUE"
run_case "flag-before-number --merge"    2 0 'gh pr merge --merge 346'    "$T_VAGUE"
# User named #999, command runs 346 → STRICT path blocks (BDM-11 preserved).
run_case "wrong PR# in msg (strict)"     2 0 'gh pr merge --squash 346'   "$(make_transcript "merge #999")"

echo
echo "=== Depth 0 — flag-before-number with correct authorization is allowed ==="
run_case "--squash with #N msg"          0 0 'gh pr merge --squash 346'   "$T_OK"
run_case "--rebase with merge N msg"     0 0 'gh pr merge --rebase 346'   "$(make_transcript "merge 346")"

echo
echo "=== Depth 0 — word-boundary on PR digits ==="
T_9999="$(make_transcript "merge #9999 please")"
run_case "#9999 doesn't authorize 99999" 2 0 'gh pr merge 99999' "$T_9999"
run_case "#9999 authorizes 9999"         0 0 'gh pr merge 9999'  "$T_9999"

echo
echo "=== Depth 0 — bare-merge authorization (BDM-11 loosened policy) ==="
# No specific PR# in the message + word "merge" → authorize whatever command names.
run_case "bare 'merge'"                  0 0 'gh pr merge 346' "$(make_transcript "merge")"
run_case "'merge it'"                    0 0 'gh pr merge 346' "$(make_transcript "merge it")"
run_case "'merge them all'"              0 0 'gh pr merge 346' "$(make_transcript "merge them all")"
run_case "'go ahead and merge'"          0 0 'gh pr merge 346' "$(make_transcript "go ahead and merge")"
run_case "'yes merge'"                   0 0 'gh pr merge 346' "$(make_transcript "yes merge")"
run_case "'please merge'"                0 0 'gh pr merge 346' "$(make_transcript "please merge")"
run_case "'merge all pending PRs'"       0 0 'gh pr merge 346' "$(make_transcript "Can you merge all pending PRs in the order desired.")"
# Bare merge works even when command uses flag-before-number form.
run_case "bare merge + --squash flag"    0 0 'gh pr merge --squash 346' "$(make_transcript "merge")"

echo
echo "=== Depth 0 — bare-merge negation guard ==="
# Negation phrases suppress the bare-merge path → block.
run_case "don't merge"                   2 0 'gh pr merge 346' "$(make_transcript "don't merge")"
run_case "do not merge"                  2 0 'gh pr merge 346' "$(make_transcript "do not merge that one")"
run_case "never merge"                   2 0 'gh pr merge 346' "$(make_transcript "never merge directly to main")"
run_case "merge conflict (compound)"     2 0 'gh pr merge 346' "$(make_transcript "we have a merge conflict on the branch")"
# 'ship it' has no merge word → still blocks (covered above as well, but explicit here).
run_case "no 'merge' word at all"        2 0 'gh pr merge 346' "$(make_transcript "ship it")"

echo
echo "=== Depth 0 — non-literal forms blocked (real bypass — re-review BDP-367) ==="
T_OK346="$(make_transcript "merge #346")"
run_case 'variable form gh pr merge "$PR"'        2 0 'gh pr merge "$PR"'         "$T_OK346"
run_case 'unquoted variable gh pr merge $PR'      2 0 'gh pr merge $PR'           "$T_OK346"
run_case 'command sub gh pr merge $(echo 346)'    2 0 'gh pr merge $(echo 346)'   "$T_OK346"
run_case 'backtick gh pr merge `echo 346`'        2 0 'gh pr merge `echo 346`'    "$T_OK346"
run_case 'variable + flags gh pr merge -s "$P"'   2 0 'gh pr merge -s "$P"'       "$T_OK346"

echo
echo "=== Depth >= 1 — variable forms allowed (delegated auth) ==="
run_case "depth=1 variable form allowed"          0 1 'gh pr merge "$PR"'         "$T_OK346"
run_case "depth=1 command sub allowed"            0 1 'gh pr merge $(cat /tmp/pr)' "$T_OK346"

echo
echo "=== Depth 0 — glob chars in COMMAND don't expand against cwd ==="
# Pathname expansion bug: `for tok in $COMMAND` would expand globs. With
# set -f in place, a glob char that doesn't match anything stays as a literal
# token and the hook proceeds normally. Verify a glob-bearing command still
# extracts the digit and authorizes correctly.
run_case "glob char in command + auth"            0 0 'gh pr merge --body "*x*" 346' "$T_OK346"
run_case "glob char no auth"                      2 0 'gh pr merge --body "*y*" 999' "$T_OK346"

echo
echo "=== Depth 0 — fail-safe blocks ==="
run_case "missing transcript_path"       2 0 'gh pr merge 346'   ""
run_case "transcript path doesn't exist" 2 0 'gh pr merge 346'   "/tmp/does-not-exist-$$.jsonl"
run_case "empty user content"            2 0 'gh pr merge 346'   "$(make_empty_transcript)"

echo
echo "=== Depth >= 1 — parent-delegated authorization (no transcript check) ==="
T_NOAUTH="$(make_transcript "do whatever")"
run_case "depth=1 explicit allowed"      0 1 'gh pr merge 346'              "$T_NOAUTH"
run_case "depth=1 --squash allowed"      0 1 'gh pr merge --squash 346'     "$T_NOAUTH"
run_case "depth=1 bare merge allowed"    0 1 'gh pr merge'                  "$T_NOAUTH"
run_case "depth=1 missing transcript"    0 1 'gh pr merge 346'              ""
run_case "depth=2 (grandchild) allowed"  0 2 'gh pr merge --rebase'         "$T_NOAUTH"

echo
echo "=== Result ==="
printf 'Passed: %d  Failed: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
