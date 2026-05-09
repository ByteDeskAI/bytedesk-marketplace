#!/usr/bin/env bash
# PostToolUse hook: classify Bash tool calls and emit structured events
# to ~/.claude-sessions/<TICKET>.events for observability.
#
# Part of the fleet event-observability system (BDP-372).
# See .claude/rules/fleet.md → "Event observability".
#
# Hook contract:
#   exit 0 always — observability hooks must NEVER block tool execution.
#
# Reads PostToolUse JSON from stdin. We only need:
#   .tool_name              → "Bash" for Bash calls
#   .tool_input.command     → the bash command that was run
#
# Event format (JSONL appended to ~/.claude-sessions/<TICKET>.events):
#   {"ts":"<ISO-8601 UTC>","ticket":"<TICKET>","depth":<int>,
#    "kind":"<kind>","detail":{...}}
#
# kinds emitted today:
#   review_comment   — gh pr review ... (--comment, no verdict flag)
#   review_summary   — gh pr review ... (--approve|--request-changes)
#   merge            — gh pr merge ...
#   pr_opened        — gh pr create ...
#   commit_pushed    — git push ...

set -u

# Always exit 0 even if anything errors. We catch errors and log them but
# never propagate.
trap 'exit 0' ERR EXIT

EVENTS_DIR="${HOME}/.claude-sessions"
mkdir -p "$EVENTS_DIR"

TICKET="${CLAUDE_SESSION_TICKET:-unknown}"
DEPTH="${CLAUDE_SESSION_DEPTH:-0}"
EVENTS_FILE="${EVENTS_DIR}/${TICKET}.events"
ERR_FILE="${EVENTS_DIR}/${TICKET}.events.err"

PAYLOAD="$(cat || true)"

TOOL_NAME="$(jq -r '.tool_name // empty' <<<"$PAYLOAD" 2>/dev/null || true)"
COMMAND="$(jq -r '.tool_input.command // empty' <<<"$PAYLOAD" 2>/dev/null || true)"

# Only Bash tool calls have shell commands.
[[ "$TOOL_NAME" == "Bash" ]] || exit 0
[[ -n "$COMMAND" ]] || exit 0

KIND=""
DETAIL="{}"

# Classification — order matters. More-specific patterns first.

# gh pr review with verdict flag → review_summary
if [[ "$COMMAND" =~ (^|[^a-zA-Z_/])gh[[:space:]]+pr[[:space:]]+review.*(--approve|--request-changes) ]]; then
  KIND="review_summary"
  # Try to grab PR number from the command
  PR_NUM=""
  set -f
  for tok in $COMMAND; do
    if [[ "$tok" =~ ^[0-9]+$ ]]; then PR_NUM="$tok"; fi
  done
  set +f
  # Verdict: approve | request-changes
  VERDICT="comment"
  [[ "$COMMAND" == *"--approve"* ]] && VERDICT="approve"
  [[ "$COMMAND" == *"--request-changes"* ]] && VERDICT="request-changes"
  DETAIL="$(jq -nc --arg pr "$PR_NUM" --arg v "$VERDICT" '{pr:$pr,verdict:$v}')"

# gh pr review (no verdict, comment-only)
elif [[ "$COMMAND" =~ (^|[^a-zA-Z_/])gh[[:space:]]+pr[[:space:]]+review ]]; then
  KIND="review_comment"
  PR_NUM=""
  set -f
  for tok in $COMMAND; do
    if [[ "$tok" =~ ^[0-9]+$ ]]; then PR_NUM="$tok"; fi
  done
  set +f
  DETAIL="$(jq -nc --arg pr "$PR_NUM" '{pr:$pr}')"

# gh pr merge
elif [[ "$COMMAND" =~ (^|[^a-zA-Z_/])gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$) ]]; then
  KIND="merge"
  PR_NUM=""
  set -f
  for tok in $COMMAND; do
    if [[ "$tok" =~ ^[0-9]+$ ]]; then PR_NUM="$tok"; fi
  done
  set +f
  DETAIL="$(jq -nc --arg pr "$PR_NUM" '{pr:$pr}')"

# gh pr create
elif [[ "$COMMAND" =~ (^|[^a-zA-Z_/])gh[[:space:]]+pr[[:space:]]+create ]]; then
  KIND="pr_opened"
  DETAIL="{}"

# git push (with optional remote+branch)
elif [[ "$COMMAND" =~ (^|[^a-zA-Z_/])git[[:space:]]+push([[:space:]]|$) ]]; then
  KIND="commit_pushed"
  # Try to capture branch name if "git push <remote> <branch>" form.
  BRANCH=""
  set -f
  # shellcheck disable=SC2206
  TOKENS=( $COMMAND )
  set +f
  for ((i=0; i<${#TOKENS[@]}-1; i++)); do
    if [[ "${TOKENS[$i]}" == "push" ]]; then
      # Next token is remote; one after that is branch (if present)
      if [[ -n "${TOKENS[$((i+2))]:-}" && ! "${TOKENS[$((i+2))]}" =~ ^- ]]; then
        BRANCH="${TOKENS[$((i+2))]}"
      fi
      break
    fi
  done
  DETAIL="$(jq -nc --arg b "$BRANCH" '{branch:$b}')"

else
  # Unclassified command — no event.
  exit 0
fi

# Compose and append the event line.
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
EVENT="$(jq -nc \
  --arg ts "$TS" \
  --arg ticket "$TICKET" \
  --argjson depth "$DEPTH" \
  --arg kind "$KIND" \
  --argjson detail "$DETAIL" \
  '{ts:$ts, ticket:$ticket, depth:$depth, kind:$kind, detail:$detail}' \
  2>>"$ERR_FILE")"

if [[ -n "$EVENT" ]]; then
  echo "$EVENT" >>"$EVENTS_FILE" 2>>"$ERR_FILE" || true
fi

exit 0
