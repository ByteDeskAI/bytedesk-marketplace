#!/usr/bin/env bash
# PreToolUse hook: refuse `gh pr merge` unless authorized.
#
# Authorization model — see docs/adr/0001-hierarchical-authorization.md and the
# BDM-11 policy revision in docs/RULES.md → "PR merge authorization".
#
#   Depth 0 (root session, human user):
#     STRICT path: if the user's message names a specific PR (#N, "merge N",
#     "PR N", "pull/N"), the command's PR must match it.
#     BARE path:   if the user's message contains no specific PR#, a bare
#     "merge" word authorizes whatever PR the command names. Negations
#     ("don't merge", "do not merge", "never merge", "merge conflict")
#     suppress the bare path.
#   Depth >= 1 (fleet child session):
#     Parent agent's spawn act is the authorization. Allow without per-PR check.
#
# See .claude/rules/fleet.md → "PR merge authorization".
#
# Hook contract:
#   exit 0 → allow the tool call
#   exit 2 → block, return stderr to Claude
#
# Reads PreToolUse JSON from stdin:
#   .tool_name              → "Bash" for Bash calls
#   .tool_input.command     → the bash command being run
#   .transcript_path        → JSONL transcript file for the current session

set -euo pipefail

PAYLOAD="$(cat)"

TOOL_NAME="$(jq -r '.tool_name // empty' <<<"$PAYLOAD")"
COMMAND="$(jq -r '.tool_input.command // empty' <<<"$PAYLOAD")"
TRANSCRIPT_PATH="$(jq -r '.transcript_path // empty' <<<"$PAYLOAD")"

# Only Bash calls can run gh.
[[ "$TOOL_NAME" == "Bash" ]] || exit 0

# Detect any `gh pr merge` invocation. Loose match — anchored at command-word
# boundary, no constraint on what follows `merge`. Catches:
#   gh pr merge 123
#   gh pr merge --squash 123        (flag-before-number)
#   gh pr merge 123 --squash
#   gh pr merge                     (PR inferred from current branch)
#   foo && gh pr merge ...
if [[ ! "$COMMAND" =~ (^|[^a-zA-Z_/])gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$) ]]; then
  exit 0
fi

# Hierarchical authorization (ADR-0046) — at depth >= 1, the parent agent's
# spawn act is the authorization. The transcript-based human-auth check only
# applies at the root.
SESSION_DEPTH="${CLAUDE_SESSION_DEPTH:-0}"
if (( SESSION_DEPTH >= 1 )); then
  echo "merge-guard: depth=${SESSION_DEPTH}, parent-delegated authorization — allow" >&2
  exit 0
fi

# === Root-session enforcement (depth 0) ===

# Extract the PR number being merged. Strategy: scan for the LAST bare-digit
# token in the command. Quoted values like --body "msg 99" don't match
# ^[0-9]+$ after word-splitting (the closing quote stays attached to the
# digit), so the only token that can match is a real positional arg.
#   gh pr merge 123                  → 123
#   gh pr merge --squash 123         → 123
#   gh pr merge 123 --squash         → 123
#   gh pr merge --body "x 99" 123    → 123
#
# `set -f` disables pathname expansion so glob characters in $COMMAND
# (e.g. `gh pr merge *foo* 123`) don't expand against cwd before the loop
# sees them. Restored after the loop.
PR_NUM=""
set -f
for tok in $COMMAND; do
  if [[ "$tok" =~ ^[0-9]+$ ]]; then
    PR_NUM="$tok"
  fi
done
set +f

# Refuse non-literal forms that could obscure the actual PR target.
# `gh pr merge "$PR"` or `gh pr merge $(cat /tmp/pr)` produces no bare-digit
# token, so the gh-fallback below would resolve the *branch's* PR — which may
# not be the same as the variable's runtime value, opening an auth bypass at
# depth 0 (model writes the variable form to confuse the hook).
if [[ -z "$PR_NUM" ]] && [[ "$COMMAND" =~ \$|\` ]]; then
  cat >&2 <<EOF
🛑 merge-guard: \`gh pr merge\` command contains a shell substitution ('\$' or backtick)
but no literal PR number, so the hook cannot verify which PR will actually be merged.

Use a literal digit at depth 0:
  gh pr merge 346

(Variable forms are allowed at depth >= 1, where parent-delegated authorization
applies — see ADR-0046.)
EOF
  exit 2
fi

if [[ -z "$PR_NUM" ]]; then
  PR_NUM="$(gh pr view --json number --jq .number 2>/dev/null || true)"
fi

if [[ -z "$PR_NUM" ]]; then
  cat >&2 <<EOF
🛑 merge-guard: cannot determine which PR is being merged.
The command does not contain a PR number, and \`gh pr view\` could not resolve
the current branch's PR. Use \`gh pr merge <N>\` with an explicit number.
EOF
  exit 2
fi

# Fail safe: if we can't read the transcript, BLOCK. A safety guard that
# fails open isn't a guard.
if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  cat >&2 <<EOF
🛑 merge-guard: cannot locate session transcript (transcript_path='${TRANSCRIPT_PATH}').
Refusing \`gh pr merge ${PR_NUM}\` to fail safe. Check hook payload wiring.
EOF
  exit 2
fi

# Pull the latest user-typed message. Type="user" includes both real user
# input (string content) and tool_result echoes (array content) — only
# string-content records are real user turns.
LAST_USER_MSG="$(
  jq -rs '
    map(select(.type == "user" and (.message.content | type == "string")))
    | if length > 0 then last.message.content else "" end
  ' "$TRANSCRIPT_PATH" 2>/dev/null || true
)"

if [[ -z "$LAST_USER_MSG" ]]; then
  cat >&2 <<EOF
🛑 merge-guard: no user-typed message found in transcript.
Refusing \`gh pr merge ${PR_NUM}\` to fail safe.
EOF
  exit 2
fi

# Authorization at depth 0 has two paths (BDM-11):
#
#   STRICT.   If the user's message contains a specific PR# in any recognized
#             form (#N, merge N, PR N, pull/N), the command's PR# MUST match.
#             Catches "merge #999" → blocking `gh pr merge 346` mismatches.
#
#   BARE.     If the user's message contains NO specific PR#, the bare word
#             "merge" alone authorizes whatever PR the command names. This
#             is the loosened policy from BDM-11 — strictly mechanical was
#             too friction-heavy for batch ship work. Negation phrases
#             ("don't merge", "do not merge", "never merge", and the
#             compound noun "merge conflict") suppress the bare-merge path.
#
# Word-boundary on trailing digits prevents #12 matching #123.

# 1. STRICT path. Detect any user-stated PR# first.
USER_PR_PATTERN='(#[0-9]+\b|\bmerge[[:space:]]+[0-9]+\b|\bPR[[:space:]]+[0-9]+\b|pull/[0-9]+\b)'
if grep -qiE "$USER_PR_PATTERN" <<<"$LAST_USER_MSG"; then
  if grep -qiE "(#${PR_NUM}\b|\bmerge[[:space:]]+${PR_NUM}\b|\bPR[[:space:]]+${PR_NUM}\b|pull/${PR_NUM}\b)" <<<"$LAST_USER_MSG"; then
    exit 0
  fi
  cat >&2 <<EOF
🛑 merge-guard: PR #${PR_NUM} doesn't match any PR# named in the user's latest message.

The user named at least one specific PR (e.g. \`#N\`, \`merge N\`, \`PR N\`, \`pull/N\`),
so the STRICT path applies — the command's PR# must match. Showing the diff with
\`gh pr diff ${PR_NUM}\` and asking is the right move.

Note: fleet child sessions (CLAUDE_SESSION_DEPTH >= 1) inherit authorization
from their parent and are not subject to this transcript check — see ADR-0001.
EOF
  exit 2
fi

# 2. BARE path. No specific PR# in the user's message — accept bare "merge"
#    unless the message contains an obvious negation.
NEGATION_PATTERN="\b(don'?t[[:space:]]+merge|do[[:space:]]+not[[:space:]]+merge|never[[:space:]]+merge|merge[[:space:]]+conflict)\b"
if grep -qiE '\bmerge\b' <<<"$LAST_USER_MSG" \
   && ! grep -qiE "$NEGATION_PATTERN" <<<"$LAST_USER_MSG"; then
  echo "merge-guard: bare-merge authorization (BDM-11 loosened policy) — allow #${PR_NUM}" >&2
  exit 0
fi

cat >&2 <<EOF
🛑 merge-guard: PR #${PR_NUM} is not authorized in the user's latest message.

Per project policy (see \`docs/RULES.md\` → "PR merge authorization"), depth-0
\`gh pr merge\` requires either:
  - a specific PR# in the user's message:   #${PR_NUM}, "merge ${PR_NUM}", "PR ${PR_NUM}", "pull/${PR_NUM}"
  - OR a bare "merge" (no PR# anywhere):    "merge", "merge it", "merge them all", "yes merge"

Negations like "don't merge", "do not merge", "never merge", and "merge conflict"
suppress the bare-merge path. Show the user the diff with \`gh pr diff ${PR_NUM}\`
and ask.

Note: fleet child sessions (CLAUDE_SESSION_DEPTH >= 1) inherit authorization
from their parent and are not subject to this transcript check — see ADR-0001.
EOF
exit 2
