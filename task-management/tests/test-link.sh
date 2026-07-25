#!/usr/bin/env bash
# PATH plumbing: `tm install`, and the SessionStart autolink that runs it for you.
# Never touches the real ~/.local/bin — TM_BIN_DIR redirects everything.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
TM_BIN_DIR="$(mktemp -d)"
export TM_ROOT TM_BIN_DIR
export CLAUDE_SESSION_ID="test-session"
export PATH="$TM_BIN_DIR:$PATH"
unset TM_NO_AUTOLINK
trap 'rm -rf "$TM_ROOT" "$TM_BIN_DIR"' EXIT

tm() { node "$PLUGIN_ROOT/bin/tm" "$@"; }
hook() { echo "${2:-\{\}}" | "$PLUGIN_ROOT/hooks/tm-hook.sh" "$1" 2>/dev/null; }
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected: $2 | got: ${1:0:200}" ;; esac; }
empty() { [[ -z "$1" ]] && ok "$2" || no "$2" "expected no output, got: ${1:0:200}"; }

echo "test-link"

# Autolink on SessionStart, before any store exists.
OUT="$(hook session-start)"
has "$OUT" "linked" "session-start links tm on first run"
[[ -L "$TM_BIN_DIR/tm" && -x "$TM_BIN_DIR/tm" ]] && ok "tm symlink is created and executable" || no "tm symlink is created and executable"
[[ -L "$TM_BIN_DIR/tm-dashboard" ]] && ok "tm-dashboard symlink is created" || no "tm-dashboard symlink is created"
has "$("$TM_BIN_DIR/tm" help)" "task-management store" "the linked binary runs"

# Idempotent: no second announcement, no churn.
empty "$(hook session-start)" "session-start is silent once linked"
has "$(tm install)" "already linked" "link is idempotent"

# Opt out.
rm -f "$TM_BIN_DIR/tm" "$TM_BIN_DIR/tm-dashboard"
empty "$(TM_NO_AUTOLINK=1 hook session-start)" "TM_NO_AUTOLINK suppresses autolink"
[[ ! -e "$TM_BIN_DIR/tm" ]] && ok "TM_NO_AUTOLINK creates nothing" || no "TM_NO_AUTOLINK creates nothing"

# Someone else owns the name → suggest, never clobber.
echo '#!/bin/sh' > "$TM_BIN_DIR/tm"
chmod +x "$TM_BIN_DIR/tm"
has "$(hook session-start)" "already owns" "a foreign tm is reported, not overwritten"
has "$(cat "$TM_BIN_DIR/tm")" "#!/bin/sh" "the foreign tm is left intact"
tm install >/dev/null 2>&1 && no "link refuses to clobber without --force" || ok "link refuses to clobber without --force"
tm install --force >/dev/null && ok "link --force takes the name" || no "link --force takes the name"
[[ -L "$TM_BIN_DIR/tm" ]] && ok "--force replaced it with our symlink" || no "--force replaced it with our symlink"

# Unlink removes only ours.
has "$(tm uninstall)" "$TM_BIN_DIR/tm" "unlink removes our symlinks"
[[ ! -e "$TM_BIN_DIR/tm" ]] && ok "unlink leaves the dir clean" || no "unlink leaves the dir clean"

# Broken symlink from a moved checkout heals instead of erroring.
ln -s /nonexistent/tm "$TM_BIN_DIR/tm"
has "$(hook session-start)" "linked" "a broken symlink is replaced"
[[ "$(readlink "$TM_BIN_DIR/tm")" == "$PLUGIN_ROOT/bin/tm" ]] && ok "symlink points at this checkout" || no "symlink points at this checkout"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
