#!/usr/bin/env bash
# SessionStart (Claude, Codex, Grok). In any repo: repair Grok installs sourced from a whole
# marketplace (they time out Grok's plugin loading), and fast-forward this machine's
# bytedesk-marketplace checkout from origin so its plugin caches stay current (pull-marketplace.sh).
# In a bytedesk-marketplace checkout: turn on its git hooks (scripts/git-hooks) so commits, merges
# and rebases rsync the touched plugins into the installed caches. Leaves any existing
# core.hooksPath alone. Never fails the session.
# Background work has its output detached, so it never delays the session. The file name stays
# ensure-hookspath.sh: Codex trusts a hook by its command, and renaming it would untrust it.
here=$(dirname "$0")
command -v grok >/dev/null && { nohup node "$here/../bin/plugin-rsync" fix-grok-installs >/dev/null 2>&1 & }
top=$(git rev-parse --show-toplevel 2>/dev/null)
# ponytail: the checkout is the one Claude registered; a Codex/Grok-only machine is covered when a
# session starts inside the checkout itself.
m=$(node -e 'try{const k=require(process.env.HOME+"/.claude/plugins/known_marketplaces.json").bytedesk;console.log(k.source.path||k.installLocation||"")}catch{}' 2>/dev/null)
[ -n "$m" ] || m=$top
[ -n "$m" ] && { nohup bash "$here/pull-marketplace.sh" "$m" >/dev/null 2>&1 & }
[ -n "$top" ] && [ -x "$top/scripts/git-hooks/sync-plugins" ] || exit 0
git -C "$top" config core.hooksPath >/dev/null && exit 0
git -C "$top" config core.hooksPath scripts/git-hooks
# First time on this machine: also trust the bytedesk plugin hooks in Codex, which otherwise
# waits for someone to approve each one in its TUI. Backgrounded; never delays the session.
command -v codex >/dev/null && { nohup node "$top/plugin-rsync/bin/plugin-rsync" trust-codex-hooks >/dev/null 2>&1 & }
exit 0
