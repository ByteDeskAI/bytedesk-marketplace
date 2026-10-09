#!/usr/bin/env bash
# SessionStart (Claude, Codex, Grok), in any repo. Never fails or delays the session: all work runs
# in the background with its output detached.
# - Repair Grok installs sourced from a whole marketplace (they time out Grok's plugin loading).
# - Set up and fast-forward this machine's bytedesk-marketplace checkout (pull-marketplace.sh): only
#   the directory Claude registered, so a scratch or fork clone never overwrites the global caches.
#   The repo the session starts in, when that is another checkout, is set up but not pulled.
# The file name stays ensure-hookspath.sh: Codex trusts a hook by its command, and renaming it
# would untrust it.
here=$(dirname "$0")
command -v grok >/dev/null && { nohup node "$here/../bin/plugin-rsync" fix-grok-installs >/dev/null 2>&1 & }
top=$(git rev-parse --show-toplevel 2>/dev/null)
# Only a directory source: a GitHub-registered marketplace's installLocation is Claude's own copy.
m=$(node -e 'try{const s=require(process.env.HOME+"/.claude/plugins/known_marketplaces.json").bytedesk.source;if(s.source==="directory")console.log(s.path)}catch{}' 2>/dev/null)
[ -n "$top" ] && [ "$(cd "$top" && pwd -P)" = "$(cd "$m" 2>/dev/null && pwd -P)" ] && top=
[ -n "$m" ] && [ -x "$m/scripts/git-hooks/sync-plugins" ] && { nohup bash "$here/pull-marketplace.sh" "$m" >/dev/null 2>&1 & }
[ -n "$top" ] && [ -x "$top/scripts/git-hooks/sync-plugins" ] && { nohup bash "$here/pull-marketplace.sh" "$top" setup-only >/dev/null 2>&1 & }
exit 0
