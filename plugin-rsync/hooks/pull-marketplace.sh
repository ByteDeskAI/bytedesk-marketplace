#!/usr/bin/env bash
# Set up and update a machine's bytedesk-marketplace checkout, so its plugin caches follow
# origin/main with no manual pull. Usage: pull-marketplace.sh <checkout>. Run in the background by
# ensure-hookspath.sh.
# 1. First time (core.hooksPath unset): turn on scripts/git-hooks, so commits, merges and rebases
#    rsync the touched plugins, and trust the bytedesk plugin hooks in Codex, which otherwise waits
#    for someone to approve each one in its TUI. Any existing core.hooksPath is left alone.
# 2. Fast-forward the main checkout's `main` from origin; post-merge then rsyncs what the pull
#    touched. ff-only: local commits, another branch or a worktree are left alone, and git refuses
#    on its own when the pull would overwrite uncommitted changes. At most once per 10 minutes.
m=$1
[ -x "$m/scripts/git-hooks/sync-plugins" ] || exit 0
if ! git -C "$m" config core.hooksPath >/dev/null; then
  git -C "$m" config core.hooksPath scripts/git-hooks
  command -v codex >/dev/null && node "$m/plugin-rsync/bin/plugin-rsync" trust-codex-hooks
fi
[ "$(git -C "$m" rev-parse --git-dir 2>/dev/null)" = "$(git -C "$m" rev-parse --git-common-dir 2>/dev/null)" ] || exit 0
[ "$(git -C "$m" symbolic-ref -q --short HEAD)" = main ] || exit 0
stamp="$(git -C "$m" rev-parse --absolute-git-dir)/plugin-rsync-pull.stamp"
[ -n "$(find "$stamp" -mmin -10 2>/dev/null)" ] && exit 0
touch "$stamp"
export GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes}"
git -C "$m" fetch -q origin main && git -C "$m" merge -q --ff-only origin/main
