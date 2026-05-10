#!/usr/bin/env bash
# Test fixture for .claude/hooks/event-emitter.sh.
#
# Each case runs the hook with a crafted PostToolUse payload and a
# disposable HOME pointing at a tmpdir, then asserts the events file
# contains (or doesn't contain) the expected event shape.
#
# Run: bash .claude/hooks/tests/test-event-emitter.sh

set -u  # don't `-e` — we want to keep running after failures

HOOK="$(cd "$(dirname "$0")/.." && pwd)/event-emitter.sh"
[[ -x "$HOOK" ]] || { echo "FAIL: hook not executable at $HOOK" >&2; exit 1; }

PASS=0
FAIL=0

# Run hook with isolated CLAUDE_PLUGIN_DATA + CLAUDE_PROJECT_DIR so we don't
# pollute real plugin state. Returns the events file path on stdout.
#
# CLAUDE_PROJECT_DIR is pinned to a fixed tmp path so we can compute the
# 12-char project key the same way the hook does and find the events file.
run_hook() {
  local ticket="$1" command="$2" depth="${3:-0}"
  local tmpdir data_root project_dir project_key
  tmpdir="$(mktemp -d)"
  data_root="$tmpdir/data"
  project_dir="$tmpdir/project"
  mkdir -p "$project_dir"
  # Match _project_key() in the hook: sha256 of canonical project dir, 12 chars.
  project_key="$(realpath "$project_dir" | sha256sum | cut -d' ' -f1 | head -c 12)"
  local payload
  payload="$(jq -nc --arg cmd "$command" '{tool_name:"Bash", tool_input:{command:$cmd}}')"
  CLAUDE_PLUGIN_DATA="$data_root" \
    CLAUDE_PROJECT_DIR="$project_dir" \
    CLAUDE_SESSION_TICKET="$ticket" \
    CLAUDE_SESSION_DEPTH="$depth" \
    "$HOOK" <<<"$payload" >/dev/null 2>&1
  echo "$data_root/projects/$project_key/sessions/${ticket}/events"
}

# Assert the events file contains a JSON line with kind=$2 (and optionally
# additional jq expressions to verify).
expect_event() {
  local name="$1" expected_kind="$2" events_file="$3"
  shift 3
  if [[ ! -f "$events_file" ]]; then
    printf '  \e[31mFAIL\e[0m %s — events file does not exist\n' "$name"
    FAIL=$((FAIL+1))
    return
  fi
  local kind
  kind="$(tail -n1 "$events_file" | jq -r '.kind' 2>/dev/null)"
  if [[ "$kind" != "$expected_kind" ]]; then
    printf '  \e[31mFAIL\e[0m %s — expected kind=%s, got kind=%s\n  %s\n' \
      "$name" "$expected_kind" "$kind" "$(cat "$events_file" 2>/dev/null)"
    FAIL=$((FAIL+1))
    return
  fi
  # Optional additional jq predicates
  for predicate in "$@"; do
    if ! tail -n1 "$events_file" | jq -e "$predicate" >/dev/null 2>&1; then
      printf '  \e[31mFAIL\e[0m %s — predicate failed: %s\n  %s\n' \
        "$name" "$predicate" "$(tail -n1 "$events_file")"
      FAIL=$((FAIL+1))
      return
    fi
  done
  printf '  \e[32mPASS\e[0m %s\n' "$name"
  PASS=$((PASS+1))
}

# Assert no events file was created (unclassified commands).
expect_no_event() {
  local name="$1" events_file="$2"
  if [[ -f "$events_file" ]]; then
    printf '  \e[31mFAIL\e[0m %s — unexpected events file:\n    %s\n' \
      "$name" "$(cat "$events_file")"
    FAIL=$((FAIL+1))
  else
    printf '  \e[32mPASS\e[0m %s\n' "$name"
    PASS=$((PASS+1))
  fi
}

echo "=== Classifications ==="

f="$(run_hook BDP-X 'gh pr review 346 --comment -F /tmp/c.md')"
expect_event "review_comment basic"          review_comment   "$f" \
  '.detail.pr == "346"' '.ticket == "BDP-X"' '.depth == 0'

f="$(run_hook BDP-X 'gh pr review 346 --approve -b "lgtm"')"
expect_event "review_summary --approve"      review_summary   "$f" \
  '.detail.pr == "346"' '.detail.verdict == "approve"'

f="$(run_hook BDP-X 'gh pr review 346 --request-changes -b "fix"')"
expect_event "review_summary --request-changes" review_summary "$f" \
  '.detail.verdict == "request-changes"'

f="$(run_hook BDP-X 'gh pr merge 346 --squash')"
expect_event "merge"                          merge            "$f" \
  '.detail.pr == "346"' '.kind == "merge"'

f="$(run_hook BDP-X 'gh pr create --title foo --body bar')"
expect_event "pr_opened"                      pr_opened        "$f"

f="$(run_hook BDP-X 'git push origin feature/foo')"
expect_event "commit_pushed with branch"     commit_pushed    "$f" \
  '.detail.branch == "feature/foo"'

f="$(run_hook BDP-X 'git push')"
expect_event "commit_pushed bare"             commit_pushed    "$f" \
  '.detail.branch == ""'

echo
echo "=== Unclassified commands → no event ==="

f="$(run_hook BDP-X 'echo hello')"
expect_no_event "plain echo"                  "$f"

f="$(run_hook BDP-X 'gh pr view 346')"
expect_no_event "gh pr view (read-only)"      "$f"

f="$(run_hook BDP-X 'git status')"
expect_no_event "git status"                  "$f"

f="$(run_hook BDP-X 'ls -la')"
expect_no_event "ls"                          "$f"

echo
echo "=== Missing CLAUDE_SESSION_TICKET → ticket=unknown ==="

# Build a payload + run with no CLAUDE_SESSION_TICKET set
tmpdir="$(mktemp -d)"
data_root="$tmpdir/data"
project_dir="$tmpdir/project"
mkdir -p "$project_dir"
project_key="$(realpath "$project_dir" | sha256sum | cut -d' ' -f1 | head -c 12)"
payload="$(jq -nc '{tool_name:"Bash", tool_input:{command:"gh pr merge 346"}}')"
CLAUDE_PLUGIN_DATA="$data_root" CLAUDE_PROJECT_DIR="$project_dir" \
  "$HOOK" <<<"$payload" >/dev/null 2>&1
expect_event "missing ticket env → unknown"   merge \
  "$data_root/projects/$project_key/sessions/unknown/events" \
  '.ticket == "unknown"' '.detail.pr == "346"'

echo
echo "=== Depth propagated correctly ==="

f="$(run_hook BDP-X 'gh pr merge 346' 1)"
expect_event "depth=1"                        merge            "$f" \
  '.depth == 1'

f="$(run_hook BDP-X 'gh pr merge 346' 2)"
expect_event "depth=2 (grandchild)"           merge            "$f" \
  '.depth == 2'

echo
echo "=== Hook never blocks tool execution ==="

# Bad payload (not even valid JSON) — hook must still exit 0
tmpdir="$(mktemp -d)"
data_root="$tmpdir/data"
project_dir="$tmpdir/project"
mkdir -p "$project_dir"
exit_code=0
CLAUDE_PLUGIN_DATA="$data_root" CLAUDE_PROJECT_DIR="$project_dir" \
  "$HOOK" <<<'this is not json' >/dev/null 2>&1 || exit_code=$?
if [[ "$exit_code" == "0" ]]; then
  printf '  \e[32mPASS\e[0m bad payload still exits 0\n'
  PASS=$((PASS+1))
else
  printf '  \e[31mFAIL\e[0m bad payload exit=%d (expected 0)\n' "$exit_code"
  FAIL=$((FAIL+1))
fi

# Empty stdin — also exit 0
exit_code=0
CLAUDE_PLUGIN_DATA="$data_root" CLAUDE_PROJECT_DIR="$project_dir" \
  "$HOOK" </dev/null >/dev/null 2>&1 || exit_code=$?
if [[ "$exit_code" == "0" ]]; then
  printf '  \e[32mPASS\e[0m empty stdin exits 0\n'
  PASS=$((PASS+1))
else
  printf '  \e[31mFAIL\e[0m empty stdin exit=%d\n' "$exit_code"
  FAIL=$((FAIL+1))
fi

echo
echo "=== Result ==="
printf 'Passed: %d  Failed: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
