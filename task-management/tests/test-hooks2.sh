#!/usr/bin/env bash
# TM-014 — the five hook events v0.1 never used.
# TM-015 — inferring the task from the branch, so commits link without an id.
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

hook() { echo "${2:-\{\}}" | "$PLUGIN_ROOT/hooks/tm-hook.sh" "$1" 2>/dev/null; }
tm() { node "$PLUGIN_ROOT/bin/tm" "$@"; }
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected: $2 | got: ${1:0:220}" ;; esac; }
lacks() { case "$1" in *"$2"*) no "$3" "should not contain: $2" ;; *) ok "$3" ;; esac; }
empty() { [[ -z "$1" ]] && ok "$2" || no "$2" "expected no output, got: ${1:0:200}"; }

echo "test-hooks2"

git init -q "$TM_ROOT" && git -C "$TM_ROOT" config user.email t@t && git -C "$TM_ROOT" config user.name t
echo x > "$TM_ROOT/a.txt" && git -C "$TM_ROOT" add . && git -C "$TM_ROOT" commit -qm init
tm init >/dev/null
tm epic new "Hooks" >/dev/null
tm task new "Make the parser reentrant" >/dev/null
tm task new "Something unrelated" >/dev/null

# ── PreCompact: the board must survive a context squeeze ──────────────────────
tm start TM-001 >/dev/null
PRE="$(hook pre-compact)"
has "$PRE" '"additionalContext"' "PreCompact re-injects context"
has "$PRE" "TM-001" "PreCompact names the in-progress work — this is the moment state gets lost"

# ── UserPromptSubmit: match a prompt to open work instead of duplicating it ───
MATCH="$(hook user-prompt '{"prompt":"lets make the parser reentrant now"}')"
has "$MATCH" "TM-001" "a prompt matching open work surfaces that task"
lacks "$(hook user-prompt '{"prompt":"what is the weather"}')" "TM-001" "an unrelated prompt stays quiet"
empty "$(hook user-prompt '{"prompt":"hi"}')" "a trivial prompt produces no output at all"

# ── SubagentStop: attribute parallel agent work ───────────────────────────────
hook subagent-stop '{"session_id":"agent-7"}' >/dev/null
has "$(tm log --json)" "subagent_stop" "SubagentStop lands in the event log"

# ── Notification: who is waiting, visible on the board ────────────────────────
hook notification '{"message":"Claude needs your permission to run git push"}' >/dev/null
has "$(tm log --json)" "notification" "Notification is recorded for the timeline"

# ── SessionEnd: never leave a lie in the store ────────────────────────────────
hook session-end >/dev/null
has "$(tm show TM-001 --json)" '"parked"' "SessionEnd parks work the session abandoned"
[[ "$(tm show TM-001 --json | jq -r '.parkedReason // ""')" == *session* ]] \
  && ok "the park says why" || no "the park says why"
[[ "$(cat "$TM_ROOT/.bytedesk/task-management/state.json" | jq '.claims | length')" == 0 ]] \
  && ok "SessionEnd releases the claim so another session can pick it up" \
  || no "SessionEnd releases the claim so another session can pick it up"

# ── branch → task inference (TM-015) ─────────────────────────────────────────
tm unblock TM-001 >/dev/null 2>&1
git -C "$TM_ROOT" checkout -q -b tm/TM-001-make-the-parser-reentrant
echo y >> "$TM_ROOT/a.txt" && git -C "$TM_ROOT" add . && git -C "$TM_ROOT" commit -qm "no ticket in this message"
CLAUDE_PROJECT_DIR="$TM_ROOT" hook post-bash '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"no ticket in this message\""}}' >/dev/null
has "$(tm show TM-001 --json)" '"commits"' "a commit on a tm/ branch links to its task without the id in the message"
[[ "$(tm show TM-001 --json | jq '.commits | length')" -ge 1 ]] && ok "the sha is attached" || no "the sha is attached"
[[ "$(tm show TM-002 --json | jq '.commits | length')" == 0 ]] && ok "unrelated tasks stay untouched" || no "unrelated tasks stay untouched"

# ── a ref never crosses repos (TM-036) ───────────────────────────────────────
# The store resolves from CLAUDE_PROJECT_DIR while the shell sits wherever it sits. When those are
# two different repos, `gh pr create` used to staple one project's pull request onto the other
# project's task — which is how bytedesk-persona's TM-001 came to hold 25 marketplace PR urls.
git -C "$TM_ROOT" remote remove origin 2>/dev/null || true
git -C "$TM_ROOT" remote add origin git@github.com:acme/store-repo.git
ELSEWHERE="$(mktemp -d)"
git init -q "$ELSEWHERE" && git -C "$ELSEWHERE" remote add origin git@github.com:acme/other-repo.git
BEFORE="$(tm show TM-002 --json | jq '.commits | length')"
tm start TM-002 >/dev/null 2>&1
(cd "$ELSEWHERE" && echo '{"tool_name":"Bash","tool_input":{"command":"gh pr create --title x"},"tool_response":{"stdout":"https://github.com/acme/other-repo/pull/7"}}'   | "$PLUGIN_ROOT/hooks/tm-hook.sh" post-bash >/dev/null 2>&1)
AFTER="$(tm show TM-002 --json | jq '.commits | length')"
[[ "$AFTER" == "$BEFORE" ]] && ok "a PR opened in another repo is not attached to this board's task"   || no "a PR opened in another repo is not attached to this board's task" "commits went $BEFORE → $AFTER"
has "$(cat "$TM_ROOT/.bytedesk/task-management/events.jsonl")" "git_link_skipped" "and the refusal is on the record, not silent"
rm -rf "$ELSEWHERE"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
