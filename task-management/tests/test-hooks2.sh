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
# TM-159: the commit has to actually EXIST with that message now. Before, the id was read out of the
# command string, so a payload describing a commit nobody made was enough — which is precisely the
# looseness that let a heredoc body attach nine tasks.
echo x2 >> "$TM_ROOT/a.txt" && git -C "$TM_ROOT" add . && git -C "$TM_ROOT" commit -qm "fix the parser for TM-002"
CLAUDE_PROJECT_DIR="$TM_ROOT" hook post-bash '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"fix the parser for TM-002\""}}' >/dev/null
[[ "$(tm show TM-002 --json | jq '.commits | length')" -gt "$BEFORE_2" ]] \
  && ok "a commit that NAMES its task still attaches, claim or no claim" \
  || no "a commit that NAMES its task still attaches, claim or no claim"

# ── the message is not the command string (TM-154) ────────────────────────────
# linkGit read only the Bash command, so `git commit -F <file>` and heredocs attached NOTHING
# however clearly the message named its task. The merge commit for TM-146 itself was unattributed
# for exactly this reason. -F is the case that matters: it is what anyone writing a real message uses.
BEFORE_1="$(tm show TM-001 --json | jq '.commits | length')"
printf 'TM-001: a subject that names its task\n\nBody text that names nothing.\n' > "$TM_ROOT/msg.txt"
echo m1 >> "$TM_ROOT/a.txt" && git -C "$TM_ROOT" add . && git -C "$TM_ROOT" commit -q -F "$TM_ROOT/msg.txt"
CLAUDE_PROJECT_DIR="$TM_ROOT" hook post-bash '{"tool_name":"Bash","tool_input":{"command":"git commit -F msg.txt"}}' >/dev/null
[[ "$(tm show TM-001 --json | jq '.commits | length')" -gt "$BEFORE_1" ]] \
  && ok "a -F commit whose SUBJECT names the task attaches" \
  || no "a -F commit whose SUBJECT names the task attaches"

# A trailer is the other explicit form, and the one this repo actually writes.
BEFORE_2="$(tm show TM-002 --json | jq '.commits | length')"
printf 'chore: tidy the fixtures\n\nSome prose.\n\nRefs: TM-002\n' > "$TM_ROOT/msg2.txt"
echo m2 >> "$TM_ROOT/a.txt" && git -C "$TM_ROOT" add . && git -C "$TM_ROOT" commit -q -F "$TM_ROOT/msg2.txt"
CLAUDE_PROJECT_DIR="$TM_ROOT" hook post-bash '{"tool_name":"Bash","tool_input":{"command":"git commit -F msg2.txt"}}' >/dev/null
[[ "$(tm show TM-002 --json | jq '.commits | length')" -gt "$BEFORE_2" ]] \
  && ok "a Refs: trailer attaches" \
  || no "a Refs: trailer attaches"

# The body is NOT read, or TM-146's over-attachment returns by another route: bodies in this repo
# routinely reason about other tasks in prose, and a mention is not a statement about what changed.
BEFORE_1="$(tm show TM-001 --json | jq '.commits | length')"
printf 'chore: something unrelated\n\nThis is the same shape as TM-001 defence 2, discussed at length.\n' > "$TM_ROOT/msg3.txt"
echo m3 >> "$TM_ROOT/a.txt" && git -C "$TM_ROOT" add . && git -C "$TM_ROOT" commit -q -F "$TM_ROOT/msg3.txt"
CLAUDE_PROJECT_DIR="$TM_ROOT" hook post-bash '{"tool_name":"Bash","tool_input":{"command":"git commit -F msg3.txt"}}' >/dev/null
[[ "$(tm show TM-001 --json | jq '.commits | length')" == "$BEFORE_1" ]] \
  && ok "a task merely DISCUSSED in the body attaches nothing" \
  || no "a task merely DISCUSSED in the body attaches nothing"
has "$(cat "$TM_ROOT/.bytedesk/task-management/events.jsonl")" "git_link_unattributed" "and it is recorded as unattributed, not silent"

# ── a heredoc floods the command string (TM-159) ──────────────────────────────
# TM-154 made the message readable and took the UNION of message and command string. That left the
# looser source in charge, because of how these commits are really written: the message is a heredoc
# in the SAME Bash invocation, so the whole body sits in the command string and the subject-only
# reading never gets a say. The merge commit for TM-154 itself attached to NINE tasks that way.
BEFORE_1="$(tm show TM-001 --json | jq '.commits | length')"
BEFORE_2="$(tm show TM-002 --json | jq '.commits | length')"
printf 'TM-002: the subject names exactly one task\n\nThe body reasons about TM-001 at length, as bodies here do.\n' > "$TM_ROOT/msg9.txt"
echo h1 >> "$TM_ROOT/a.txt" && git -C "$TM_ROOT" add . && git -C "$TM_ROOT" commit -q -F "$TM_ROOT/msg9.txt"
# The payload is what the hook sees when a heredoc is used: the whole message, inside the command.
CLAUDE_PROJECT_DIR="$TM_ROOT" hook post-bash "$(jq -nc --arg c "$(printf 'git commit -F - <<MSG\nTM-002: the subject names exactly one task\n\nThe body reasons about TM-001 at length, as bodies here do.\nMSG')" '{tool_name:"Bash",tool_input:{command:$c}}')" >/dev/null
[[ "$(tm show TM-002 --json | jq '.commits | length')" -gt "$BEFORE_2" ]] \
  && ok "the task its SUBJECT names still attaches" \
  || no "the task its SUBJECT names still attaches"
[[ "$(tm show TM-001 --json | jq '.commits | length')" == "$BEFORE_1" ]] \
  && ok "a task discussed in the body does NOT attach, even though the heredoc put it in the command string" \
  || no "a task discussed in the body does NOT attach, even though the heredoc put it in the command string"

# The inline form must keep working: -m puts the id in the message too, so git log still sees it.
BEFORE_1="$(tm show TM-001 --json | jq '.commits | length')"
echo h2 >> "$TM_ROOT/a.txt" && git -C "$TM_ROOT" add . && git -C "$TM_ROOT" commit -qm "TM-001: fixed inline"
CLAUDE_PROJECT_DIR="$TM_ROOT" hook post-bash '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"TM-001: fixed inline\""}}' >/dev/null
[[ "$(tm show TM-001 --json | jq '.commits | length')" -gt "$BEFORE_1" ]] \
  && ok "an inline -m commit naming its task still attaches" \
  || no "an inline -m commit naming its task still attaches"

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
