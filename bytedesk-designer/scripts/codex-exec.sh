#!/usr/bin/env bash
# Bounded, varying, disclosed retry around `codex exec`.
#
# Three things make this different from `try again`:
#
#   Idempotence. Codex writes images to ~/.codex/generated_images/<session-id>/ as soon as
#   the tool returns, so an invocation can produce its artifact and THEN hang. Retrying that
#   blindly bills a second generation and files a duplicate. Every attempt checks the disk
#   before the next one starts.
#
#   Variation. Retrying the identical command that just failed is superstition. Each attempt
#   changes the thing most likely to be at fault, cheapest first.
#
#   Disclosure. Writes <name>.attempts.json recording what was tried and what worked, so the
#   stage can say "attempt 2, via a scoped CODEX_HOME" instead of implying a clean first run.
#   A workaround nobody is told about is the failure this suite is built to prevent.
#
# Usage: codex-exec.sh <run-dir> <name> <prompt-file> [image|text] [extra codex args...]
# Exit:  0 success (see .attempts.json for which attempt), 1 exhausted, 2 bad usage.

set -uo pipefail
RUN="${1:?run-dir}"; NAME="${2:?name}"; PROMPT="${3:?prompt-file}"; MODE="${4:-text}"; shift 4 || shift 3
EXTRA=("$@")   # extra codex args, e.g. -i <image> for the blind critic
[ -f "$PROMPT" ] || { echo "codex-exec: no prompt at $PROMPT" >&2; exit 2; }
mkdir -p "$RUN"

IMG_ROOT="${CODEX_IMAGE_ROOT:-$HOME/.codex/generated_images}"
TIMEOUT="${CODEX_TIMEOUT:-300}"      # images run 2-4 min; 300s is generous, not patient
ATTEMPTS_LOG="$RUN/$NAME.attempts.json"
: > "$RUN/$NAME.attempts.tmp"

# Did this attempt actually produce something, whatever the exit code said?
# $2 is where THIS attempt's images land: codex writes them under its own CODEX_HOME, so an
# attempt that scopes CODEX_HOME does not file them under $HOME. Checking only $HOME made
# every scoped-home image attempt report produced:false while having generated — and been
# billed for — the image, then fall through to the next attempt and generate it again.
produced() {
  local log="$1" root="${2:-$IMG_ROOT}" sid
  sid=$(grep -oiE 'session id: *[0-9a-f-]+' "$log" 2>/dev/null | head -1 | grep -oE '[0-9a-f-]{8,}')
  [ -n "$sid" ] && echo "$sid" > "$RUN/$NAME.session-id"
  if [ "$MODE" = image ]; then
    [ -n "$sid" ] && [ -d "$root/$sid" ] && [ -n "$(ls -A "$root/$sid" 2>/dev/null)" ] \
      && { echo "$root/$sid" > "$RUN/$NAME.image-dir"; true; }
  else
    [ -s "$RUN/$NAME-reply.txt" ]
  fi
}

run_attempt() {                       # $1 label, $2... env assignments
  local label="$1"; shift
  local log="$RUN/$NAME-log.txt"
  local root="$IMG_ROOT"
  for kv in "$@"; do case "$kv" in CODEX_HOME=*) root="${kv#CODEX_HOME=}/generated_images" ;; esac; done
  local t0=$SECONDS
  # -o must be ABSOLUTE: it resolves against the invoking shell, not -C.
  timeout "$TIMEOUT" env "$@" codex exec --skip-git-repo-check -s read-only \
      -C "$RUN" -o "$RUN/$NAME-reply.txt" ${EXTRA[@]+"${EXTRA[@]}"} - < "$PROMPT" > "$log" 2>&1
  local rc=$? el=$((SECONDS - t0))
  local ok=false; produced "$log" "$root" && ok=true
  printf '{"attempt":"%s","exit":%d,"seconds":%d,"produced":%s},' "$label" "$rc" "$el" "$ok" \
    >> "$RUN/$NAME.attempts.tmp"
  $ok
}

finish() {                            # $1 outcome, $2 note
  printf '{"name":"%s","mode":"%s","outcome":"%s","note":"%s","attempts":[%s]}\n' \
    "$NAME" "$MODE" "$1" "$2" "$(sed 's/,$//' "$RUN/$NAME.attempts.tmp")" > "$ATTEMPTS_LOG"
  rm -f "$RUN/$NAME.attempts.tmp"
}

# 1 — as asked.
run_attempt "direct" PATH="$PATH" && { finish ok "first attempt"; exit 0; }

# 2 — scoped CODEX_HOME. A large ~/.codex/config.toml starts every declared MCP server
#     before running the prompt; one slow or unreachable server stalls startup indefinitely.
#     Same binary, same sign-in, none of that. Measured: 120s+ hang becomes seconds.
SCOPED="${TMPDIR:-/tmp}/codex-min-$$"
if [ -f "$HOME/.codex/auth.json" ]; then
  mkdir -p "$SCOPED" && cp "$HOME/.codex/auth.json" "$SCOPED/"
  grep -E '^\s*model\s*=' "$HOME/.codex/config.toml" 2>/dev/null | head -1 > "$SCOPED/config.toml" || true
  run_attempt "scoped-home" CODEX_HOME="$SCOPED" PATH="$PATH" && {
    finish ok "attempt 2 — the default CODEX_HOME stalls; a scoped one works. Report this: the operator's codex exec is broken for everything else too."
    exit 0; }
fi

# 3 — backoff, then once more. Covers contention rather than configuration: many concurrent
#     sessions on one machine will starve each other regardless of config.
sleep "${CODEX_BACKOFF:-45}"
run_attempt "after-backoff" PATH="$PATH" && { finish ok "attempt 3 — succeeded after backoff; the machine was saturated"; exit 0; }

finish exhausted "three attempts: direct, scoped CODEX_HOME, and after backoff. Do not write the artifact yourself - report which attempts were made and keep the prompt."
exit 1
