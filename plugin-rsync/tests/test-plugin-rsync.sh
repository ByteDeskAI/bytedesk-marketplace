#!/usr/bin/env bash
# Isolated HOME. Never touches the real plugin caches.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0
fail=0
ok() { pass=$((pass + 1)); echo "  ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL $1"; [ -n "${2:-}" ] && echo "       $2"; }

setup() {
  SANDBOX="$(mktemp -d)"
  export HOME="$SANDBOX"
  export BYTEDESK_MARKETPLACE="$SANDBOX/market"
  mkdir -p "$BYTEDESK_MARKETPLACE/.claude-plugin" \
    "$BYTEDESK_MARKETPLACE/alpha" \
    "$BYTEDESK_MARKETPLACE/beta" \
    "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/.claude-plugin" \
    "$HOME/.claude/plugins/cache/bytedesk/beta/sha2/.claude-plugin" \
    "$HOME/.claude/plugins/cache/bytedesk/alpha/.claude-plugin" \
    "$HOME/.grok/installed-plugins/bd-alpha/alpha/.claude-plugin" \
    "$HOME/.codex/plugins/cache/bytedesk/alpha/c1/.claude-plugin" \
    "$HOME/.local/bin"
  printf '{}\n' > "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/.claude-plugin/plugin.json"
  printf '{}\n' > "$HOME/.claude/plugins/cache/bytedesk/beta/sha2/.claude-plugin/plugin.json"
  printf '{}\n' > "$HOME/.claude/plugins/cache/bytedesk/alpha/.claude-plugin/plugin.json"
  printf '{}\n' > "$HOME/.grok/installed-plugins/bd-alpha/alpha/.claude-plugin/plugin.json"
  printf '{}\n' > "$HOME/.codex/plugins/cache/bytedesk/alpha/c1/.claude-plugin/plugin.json"
  printf '%s\n' '{"name":"bytedesk","plugins":[{"name":"alpha","source":"./alpha"},{"name":"beta","source":"./beta"}]}' \
    > "$BYTEDESK_MARKETPLACE/.claude-plugin/marketplace.json"
  printf 'source-a\n' > "$BYTEDESK_MARKETPLACE/alpha/marker.txt"
  printf 'source-b\n' > "$BYTEDESK_MARKETPLACE/beta/marker.txt"
  mkdir -p "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/node_modules"
  printf 'keep-me\n' > "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/node_modules/stay.txt"
  printf 'stale\n' > "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/gone.txt"
  printf '%s\n' '{"version":1,"repos":{"bd-alpha":{"kind":{"type":"Local","source_path":"'"$BYTEDESK_MARKETPLACE"'","subdir":"alpha"},"path":"'"$HOME"'/.grok/installed-plugins/bd-alpha","plugins":{"alpha":{"subdir":"alpha"}}}}}' \
    > "$HOME/.grok/installed-plugins/registry.json"
}

teardown() { rm -rf "$SANDBOX"; }
run() { node "$ROOT/bin/plugin-rsync" "$@"; }

echo "test-plugin-rsync"

setup
mkdir -p "$HOME/.grok/installed-plugins/bd-alpha/beta"
out=$(run --list)
echo "$out" | grep -q 'alpha' && echo "$out" | grep -q 'sha1' && ok "--list shows claude dests" || bad "--list claude" "$out"
echo "$out" | grep -q 'grok' && ok "--list shows grok dests" || bad "--list grok" "$out"
echo "$out" | grep -q 'codex' && ok "--list shows codex dests" || bad "--list codex" "$out"
echo "$out" | grep -q 'bd-alpha/beta' && bad "a grok install of alpha must not claim a sibling beta dir" "$out" || ok "grok dests stay on the declared plugin"
echo "$out" | grep -q 'cache/bytedesk/alpha/.claude-plugin' && bad "dot-dirs at the cache root are not installs" "$out" || ok "cache dot-dirs are skipped"
teardown

setup
run alpha >/dev/null
got=$(cat "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/marker.txt")
[[ "$got" == "source-a" ]] && ok "rsync copies source into the claude cache" || bad "claude copy" "$got"
[[ ! -f "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/gone.txt" ]] && ok "--delete drops dest-only files" || bad "stale file survived"
[[ -f "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/node_modules/stay.txt" ]] && ok "node_modules is not deleted" || bad "node_modules wiped"
got=$(cat "$HOME/.grok/installed-plugins/bd-alpha/alpha/marker.txt")
[[ "$got" == "source-a" ]] && ok "rsync copies into the grok install" || bad "grok copy" "$got"
got=$(cat "$HOME/.codex/plugins/cache/bytedesk/alpha/c1/marker.txt")
[[ "$got" == "source-a" ]] && ok "rsync copies into the codex cache" || bad "codex copy" "$got"
[[ ! -f "$HOME/.claude/plugins/cache/bytedesk/beta/sha2/marker.txt" ]] && ok "a named plugin does not touch the others" || bad "beta was copied on alpha-only run"
teardown

setup
run alpha,beta >/dev/null
[[ -f "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/marker.txt" && -f "$HOME/.claude/plugins/cache/bytedesk/beta/sha2/marker.txt" ]] \
  && ok "comma-separated names rsync both" || bad "comma list"
teardown

setup
run alpha beta >/dev/null
[[ -f "$HOME/.claude/plugins/cache/bytedesk/beta/sha2/marker.txt" ]] && ok "space-separated names rsync both" || bad "space list"
teardown

setup
run >/dev/null
[[ -f "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/marker.txt" && -f "$HOME/.claude/plugins/cache/bytedesk/beta/sha2/marker.txt" ]] \
  && ok "no args rsyncs every catalog plugin that is installed" || bad "default all"
teardown

setup
out=$(run nope 2>&1); rc=$?
[[ $rc -ne 0 ]] && echo "$out" | grep -q 'not in the marketplace' && ok "unknown name is an error" || bad "unknown" "$out rc=$rc"
teardown

setup
rm -rf "$HOME/.claude/plugins/cache/bytedesk/beta" "$HOME/.codex" "$HOME/.grok"
out=$(run beta 2>&1); rc=$?
[[ $rc -ne 0 ]] && echo "$out" | grep -q 'not installed' && ok "named but uninstalled is an error" || bad "uninstalled" "$out rc=$rc"
teardown

setup
out=$(run --dry-run alpha)
echo "$out" | grep -q 'rsync' && [[ ! -f "$HOME/.claude/plugins/cache/bytedesk/alpha/sha1/marker.txt" ]] \
  && ok "--dry-run prints rsync and copies nothing" || bad "dry-run" "$out"
teardown

setup
run install-cli >/dev/null
[[ -x "$HOME/.local/bin/plugin-rsync" ]] && grep -q plugin-rsync-setup-cli-wrapper "$HOME/.local/bin/plugin-rsync" \
  && ok "install-cli writes a user-scope wrapper" || bad "install-cli"
printf '#!/bin/sh\necho foreign\n' > "$HOME/.local/bin/plugin-rsync"
out=$(run install-cli 2>&1); rc=$?
[[ $rc -ne 0 ]] && echo "$out" | grep -q 'not overwriting' && ok "install-cli refuses a foreign wrapper" || bad "foreign wrapper" "$out rc=$rc"
teardown

echo
echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
