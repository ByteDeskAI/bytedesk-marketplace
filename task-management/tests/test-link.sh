#!/usr/bin/env bash
# Project-local launcher contract. No command is installed into a user PATH.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
FAKE_HOME="$(mktemp -d)"
export TM_ROOT TM_PLUGIN_ROOT="$PLUGIN_ROOT" HOME="$FAKE_HOME"
export CLAUDE_CODE_SESSION_ID="test-session"
trap 'rm -rf "$TM_ROOT" "$FAKE_HOME"' EXIT

tm_bootstrap() { node "$PLUGIN_ROOT/bin/tm" "$@"; }
hook() { echo "${2:-\{\}}" | "$PLUGIN_ROOT/hooks/tm-hook.sh" "$1" 2>/dev/null; }
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected: $2 | got: ${1:0:200}" ;; esac; }

echo "test-link"

tm_bootstrap init >/dev/null
BIN="$TM_ROOT/.bytedesk/task-management/bin"

for cmd in tm tm-hook tm-dashboard; do
  [[ -x "$BIN/$cmd" ]] && ok "$cmd POSIX launcher is executable" || no "$cmd POSIX launcher is executable"
  [[ -f "$BIN/$cmd.cmd" ]] && ok "$cmd Windows launcher exists" || no "$cmd Windows launcher exists"
done

has "$(TM_PLUGIN_ROOT="$PLUGIN_ROOT" "$BIN/tm" help)" "task-management store" "the project tm launcher runs"

# SessionStart repairs project launchers only after the store exists.
rm -f "$BIN/tm-hook" "$BIN/tm-hook.cmd"
hook session-start >/dev/null
[[ -x "$BIN/tm-hook" && -f "$BIN/tm-hook.cmd" ]] \
  && ok "session-start restores missing project launchers" \
  || no "session-start restores missing project launchers"

# Project setup never claims a global command name.
for cmd in tm tm-hook tm-dashboard; do
  [[ ! -e "$FAKE_HOME/.local/bin/$cmd" && ! -e "$FAKE_HOME/.local/bin/$cmd.cmd" ]] \
    && ok "$cmd is not globally installed" \
    || no "$cmd is not globally installed"
done

# Removed verbs must not silently recreate the old global contract.
tm_bootstrap install >/dev/null 2>&1 \
  && no "the removed install verb fails" \
  || ok "the removed install verb fails"
tm_bootstrap uninstall >/dev/null 2>&1 \
  && no "the removed uninstall verb fails" \
  || ok "the removed uninstall verb fails"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
