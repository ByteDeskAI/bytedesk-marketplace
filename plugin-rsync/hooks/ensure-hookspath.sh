#!/usr/bin/env bash
# SessionStart (Claude, Codex, Grok), in any repo. Never fails or delays the session: all work runs
# in the background with its output detached.
# - Repair Grok installs sourced from a whole marketplace (they time out Grok's plugin loading).
# - Set up and fast-forward this machine's bytedesk-marketplace checkout (pull-marketplace.sh): the
#   directory Claude registered, and the repo the session starts in when that is a checkout.
# The file name stays ensure-hookspath.sh: Codex trusts a hook by its command, and renaming it
# would untrust it.
here=$(dirname "$0")
command -v grok >/dev/null && { nohup node "$here/../bin/plugin-rsync" fix-grok-installs >/dev/null 2>&1 & }
top=$(git rev-parse --show-toplevel 2>/dev/null)
# Only a directory source: a GitHub-registered marketplace's installLocation is Claude's own copy.
m=$(node -e 'try{const s=require(process.env.HOME+"/.claude/plugins/known_marketplaces.json").bytedesk.source;if(s.source==="directory")console.log(s.path)}catch{}' 2>/dev/null)
[ -n "$top" ] && [ "$(cd "$top" && pwd -P)" = "$(cd "$m" 2>/dev/null && pwd -P)" ] && top=
for d in "$m" "$top"; do
  [ -n "$d" ] || continue
  [ -x "$d/scripts/git-hooks/sync-plugins" ] || continue
  nohup bash "$here/pull-marketplace.sh" "$d" >/dev/null 2>&1 &
done
exit 0
