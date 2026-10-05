#!/usr/bin/env bash
# SessionStart (Claude, Codex, Grok): in a bytedesk-marketplace checkout, turn on its git hooks
# (scripts/git-hooks) so commits, merges and rebases rsync the touched plugins into the installed
# caches. Leaves any existing core.hooksPath alone. Never fails the session.
top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -x "$top/scripts/git-hooks/sync-plugins" ] || exit 0
git -C "$top" config core.hooksPath >/dev/null && exit 0
git -C "$top" config core.hooksPath scripts/git-hooks
# First time on this machine: also trust the bytedesk plugin hooks in Codex, which otherwise
# waits for someone to approve each one in its TUI. Backgrounded; never delays the session.
command -v codex >/dev/null && { nohup node "$top/plugin-rsync/bin/plugin-rsync" trust-codex-hooks >/dev/null 2>&1 & }
exit 0
