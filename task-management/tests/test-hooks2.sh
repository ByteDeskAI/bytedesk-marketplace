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
tm task new "Make the parser reentrant" --body "context" --ac "the parser is reentrant" >/dev/null
tm task new "Something unrelated" --body "context" --ac "it stays untouched" >/dev/null

# ── PreCompact: the board must survive a context squeeze ──────────────────────
tm start TM-001 >/dev/null
PRE="$(hook pre-compact)"
has "$PRE" '"additionalContext"' "PreCompact re-injects context"
has "$PRE" "TM-001" "PreCompact names the in-progress work — this is the moment state gets lost"

# A store-less directory still has to answer, and answer in JSON. Codex validates this
# hook's stdout and rejects empty output as "invalid PreCompact hook JSON output", so
# exiting 0 silently broke every Codex session whose cwd was outside a store.
BARE_ROOT="$(mktemp -d)"
PRE_BARE="$(TM_ROOT="$BARE_ROOT" "$PLUGIN_ROOT/hooks/tm-hook.sh" pre-compact </dev/null 2>/dev/null)"
has "$PRE_BARE" '{}' "PreCompact answers in JSON with no store — empty stdout is what Codex rejects"
lacks "$PRE_BARE" 'additionalContext' "no store means no board to re-inject, and it says so"
rm -rf "$BARE_ROOT"

# Codex runs plugin hooks from inside the installed plugin, not the project, and passes a hook
# no environment at all — so cwd and CLAUDE_PROJECT_DIR both fail to name the board and only the
# payload's cwd does. Without this the board was silently never restored on Codex compaction.
AWAY="$(mktemp -d)"
PRE_CWD="$(cd "$AWAY" && printf '{"session_id":"codex-x","cwd":"%s"}' "$TM_ROOT" \
  | env -u CLAUDE_PROJECT_DIR TM_ROOT= "$PLUGIN_ROOT/hooks/tm-hook.sh" pre-compact 2>/dev/null)"
has "$PRE_CWD" "TM-001" "PreCompact finds the board the payload names, not the one cwd stands in"
rm -rf "$AWAY"

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

# ── a claim is not evidence about a ref (TM-146) ──────────────────────────────
# The commit-side path used to fall back to whatever task held the claim when the message named no
# task. So a commit that touched something else entirely was recorded against it: TM-140 and TM-141
# each collected TM-142's merge and a rules commit, while the commit carrying their own fix was
# absent. A claim says who is working; a ref says what changed.
#
# The branch-name case above is the sibling that already behaved correctly, so it is not repeated
# here — this block is the claim-only case and the explicit-mention control.
git -C "$TM_ROOT" add -A >/dev/null 2>&1 && git -C "$TM_ROOT" commit -qm "store churn" >/dev/null 2>&1
git -C "$TM_ROOT" checkout -q -b chore/no-task-here
tm start TM-002 >/dev/null 2>&1
BEFORE_1="$(tm show TM-001 --json | jq '.commits | length')"
BEFORE_2="$(tm show TM-002 --json | jq '.commits | length')"
echo z >> "$TM_ROOT/a.txt" && git -C "$TM_ROOT" add . && git -C "$TM_ROOT" commit -qm "tidy up the fixtures"
CLAUDE_PROJECT_DIR="$TM_ROOT" hook post-bash '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"tidy up the fixtures\""}}' >/dev/null
[[ "$(tm show TM-002 --json | jq '.commits | length')" == "$BEFORE_2" ]] \
  && ok "a commit naming no task, on a branch naming no task, attaches nothing to the CLAIMED task" \
  || no "a commit naming no task, on a branch naming no task, attaches nothing to the CLAIMED task"
[[ "$(tm show TM-001 --json | jq '.commits | length')" == "$BEFORE_1" ]] \
  && ok "and nothing to any other task either" \
  || no "and nothing to any other task either"
has "$(cat "$TM_ROOT/.bytedesk/task-management/events.jsonl")" "git_link_unattributed" "the unattributed commit is on the record, not silent"

# The explicit signal must still work from this same branch, or the fix would be a regression.
CLAUDE_PROJECT_DIR="$TM_ROOT" hook post-bash '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"fix the parser for TM-002\""}}' >/dev/null
[[ "$(tm show TM-002 --json | jq '.commits | length')" -gt "$BEFORE_2" ]] \
  && ok "a commit that NAMES its task still attaches, claim or no claim" \
  || no "a commit that NAMES its task still attaches, claim or no claim"

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

# ── the ref's own repo is the authority, not the cwd (TM-063) ────────────────
# The case above moves the *process*, so the directory check catches it. The failure that actually
# shipped never moved: `gh pr create` targeted another repo while CLAUDE_PROJECT_DIR still pointed
# at this store, so boardId(CHECKOUT) answered "same board" and the link went through. It bites
# because every store numbers tasks TM-nnn — the PR body named the *other* project's TM-063, and
# this board had a TM-063 of its own, closed days earlier under a different epic.
BEFORE="$(tm show TM-002 --json | jq '.commits | length')"
CLAUDE_PROJECT_DIR="$TM_ROOT" hook post-bash '{"tool_name":"Bash","tool_input":{"command":"gh pr create --repo acme/other-repo --body \"adjudicates TM-002\""},"tool_response":{"stdout":"https://github.com/acme/other-repo/pull/17"}}' >/dev/null
AFTER="$(tm show TM-002 --json | jq '.commits | length')"
[[ "$AFTER" == "$BEFORE" ]] \
  && ok "a PR in another repo is refused even when the cwd says this board" \
  || no "a PR in another repo is refused even when the cwd says this board" "commits went $BEFORE → $AFTER"

# A `gh pr create` with no URL to read used to write the literal string "pr" as the ref.
BEFORE="$(tm show TM-002 --json | jq '.commits | length')"
CLAUDE_PROJECT_DIR="$TM_ROOT" hook post-bash '{"tool_name":"Bash","tool_input":{"command":"gh pr create --body \"about TM-002\""},"tool_response":{"stdout":""}}' >/dev/null
[[ "$(tm show TM-002 --json | jq -r '.commits | index("pr") // "none"')" == "none" ]] \
  && ok "a PR that printed no URL attaches nothing, not the literal \"pr\"" \
  || no "a PR that printed no URL attaches nothing, not the literal \"pr\""

# The guard must still let this board's own pull requests through.
CLAUDE_PROJECT_DIR="$TM_ROOT" hook post-bash '{"tool_name":"Bash","tool_input":{"command":"gh pr create --body \"closes TM-002\""},"tool_response":{"stdout":"https://github.com/acme/store-repo/pull/9"}}' >/dev/null
has "$(tm show TM-002 --json)" "acme/store-repo/pull/9" "a PR in this board's own repo still links"

# ── hooks degrade rather than block, under any harness (TM-039) ──────────────
# Claude Code is the only CLI that invokes these, so under Codex or Grok they must simply not run
# — never half-run and never block a turn. Exit 0 on a foreign payload, a malformed one, and on
# the Stop gate with no Claude Code variable set at all.
for CASE in '{}' '{"tool_name":"update_plan","tool_input":{"plan":[]}}' 'not json at all'; do
  echo "$CASE" | env -u CLAUDE_CODE_SESSION_ID CODEX_THREAD_ID=t-1 "$PLUGIN_ROOT/hooks/tm-hook.sh" pre-tool-use >/dev/null 2>&1
  [[ "$?" == 0 ]] && ok "pre-tool-use exits clean on: ${CASE:0:28}" || no "pre-tool-use exits clean on: ${CASE:0:28}" "exit $?"
done
echo '{}' | env -u CLAUDE_CODE_SESSION_ID GROK_SESSION_ID=g-1 "$PLUGIN_ROOT/hooks/tm-hook.sh" stop >/dev/null 2>&1
[[ "$?" == 0 ]] && ok "the Stop gate does not block a harness it cannot see" || no "the Stop gate does not block a harness it cannot see" "exit $?"

# ── the hook works under Codex, on a payload Codex actually sent (TM-042) ────
# The fixture is verbatim from codex-cli 0.146.0, captured by a hook writing its stdin to a file
# during `codex exec`. The load-bearing difference from Claude Code: Codex passes a hook NO
# environment variables, so the session has to come off the payload or every claim, gate and event
# attributes to nobody.
FIXTURE="$PLUGIN_ROOT/tests/fixtures/codex-pre-tool-use.json"
CODEX_SESSION="$(jq -r .session_id "$FIXTURE")"
tm task new "work claimed the codex way" --body "context" --ac "the claim attributes" >/dev/null 2>&1
CODEX_TASK="$(tm find "work claimed the codex way" --json | jq -r '.[0].id')"
# Claim it as Codex would: no CLAUDE_* variable anywhere, session named only on the JSON.
env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_SESSION_ID TM_SESSION_ID="$CODEX_SESSION" \
  node "$PLUGIN_ROOT/bin/tm" start "$CODEX_TASK" >/dev/null 2>&1
CLAIMED_BY="$(jq -r --arg id "$CODEX_TASK" '.claims[$id].session // "none"' "$TM_ROOT/.bytedesk/task-management/state.json")"
[[ "$CLAIMED_BY" == "$CODEX_SESSION" ]] && ok "a Codex session id owns its claim" || no "a Codex session id owns its claim" "claimed by $CLAIMED_BY"

# And the hook adopts it from the payload with nothing in the environment at all.
OUT="$(env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_SESSION_ID -u TM_SESSION_ID \
  "$PLUGIN_ROOT/hooks/tm-hook.sh" post-tool-use < "$FIXTURE" 2>&1; echo "exit=$?")"
case "$OUT" in
  *exit=0*) ok "the hook accepts a real Codex payload without blocking the turn" ;;
  *) no "the hook accepts a real Codex payload without blocking the turn" "${OUT:0:200}" ;;
esac
LAST_SESSION="$(tail -1 "$TM_ROOT/.bytedesk/task-management/events.jsonl" | jq -r '.session // "none"')"
[[ "$LAST_SESSION" != "none" ]] && ok "the event it wrote is attributed, not anonymous" || no "the event it wrote is attributed, not anonymous" "session was null"

# The payload beats the environment, which this originally had backwards. A hook process inherits
# the environment of whatever launched the harness, so running `codex` from a Claude Code shell
# leaves CLAUDE_CODE_SESSION_ID set — and every task Codex created was attributed to the Claude
# session that spawned it. Found by running codex for real, not by reading the code.
CLAUDE_CODE_SESSION_ID="a-claude-session-that-is-merely-inherited" \
  "$PLUGIN_ROOT/hooks/tm-hook.sh" post-tool-use < "$FIXTURE" >/dev/null 2>&1
ATTRIBUTED="$(tail -1 "$TM_ROOT/.bytedesk/task-management/events.jsonl" | jq -r '.session // "none"')"
[[ "$ATTRIBUTED" == "$CODEX_SESSION" ]] \
  && ok "the harness naming its own session beats one inherited from another harness" \
  || no "the harness naming its own session beats one inherited from another harness" "attributed to $ATTRIBUTED"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
