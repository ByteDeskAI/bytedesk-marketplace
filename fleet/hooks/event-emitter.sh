#!/usr/bin/env bash
# PostToolUse hook: classify Bash tool calls and emit structured events
# to ${CLAUDE_PLUGIN_DATA}/projects/<KEY>/sessions/<TICKET>/events for
# observability.
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
# Event format (JSONL appended to <session_dir>/events):
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

# ─── Per-project data layout (BDM-3) ──────────────────────────────────────────
# Hook can run from anywhere; cwd is unreliable. Prefer CLAUDE_PROJECT_DIR
# (set by Claude Code) over PWD for git-aware project keying. Mirrors the
# helpers in fleet/bin/claude-sessions; kept inline to avoid sourcing.
_canonical_dir() {
  local cwd="${CLAUDE_PROJECT_DIR:-$PWD}"
  local gcd
  if gcd="$(git -C "$cwd" rev-parse --git-common-dir 2>/dev/null)" && [[ -n "$gcd" ]]; then
    # `git -C $cwd rev-parse` may print a relative path; resolve it relative
    # to $cwd so we land in the main repo's .git dir even from a worktree.
    case "$gcd" in
      /*) : ;;
      *)  gcd="$cwd/$gcd" ;;
    esac
    dirname "$(realpath "$gcd")"
  else
    realpath "$cwd"
  fi
}
_project_key()   { _canonical_dir | sha256sum | cut -d' ' -f1 | head -c 12; }
_data_root()     { echo "${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/fleet}"; }
_session_dir()   { echo "$(_data_root)/projects/$(_project_key)/sessions/$1"; }

TICKET="${CLAUDE_SESSION_TICKET:-unknown}"
DEPTH="${CLAUDE_SESSION_DEPTH:-0}"
SESSION_DIR="$(_session_dir "$TICKET")"
mkdir -p "$SESSION_DIR"
EVENTS_FILE="${SESSION_DIR}/events"
ERR_FILE="${SESSION_DIR}/events.err"

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
