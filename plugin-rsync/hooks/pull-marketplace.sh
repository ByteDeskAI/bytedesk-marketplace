#!/usr/bin/env bash
# Keep a machine's bytedesk-marketplace checkout current, so its plugin caches follow origin/main
# with no manual pull. Fast-forwards the main checkout's `main` from origin; the checkout's
# post-merge hook (core.hooksPath=scripts/git-hooks) then rsyncs the plugins the pull touched.
# ff-only: local commits, another branch or a worktree are left alone, and git refuses on its own
# when the pull would overwrite uncommitted changes. At most once per 10 minutes per checkout.
# Usage: pull-marketplace.sh <checkout>. Run in the background by ensure-hookspath.sh.
m=$1
[ -x "$m/scripts/git-hooks/sync-plugins" ] || exit 0
[ "$(git -C "$m" rev-parse --git-dir 2>/dev/null)" = "$(git -C "$m" rev-parse --git-common-dir 2>/dev/null)" ] || exit 0
[ "$(git -C "$m" symbolic-ref -q --short HEAD)" = main ] || exit 0
stamp="$(git -C "$m" rev-parse --absolute-git-dir)/plugin-rsync-pull.stamp"
[ -n "$(find "$stamp" -mmin -10 2>/dev/null)" ] && exit 0
touch "$stamp"
git -C "$m" config core.hooksPath >/dev/null || git -C "$m" config core.hooksPath scripts/git-hooks
export GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes}"
git -C "$m" fetch -q origin main && git -C "$m" merge -q --ff-only origin/main
