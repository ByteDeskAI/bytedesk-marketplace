#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2034 # assertions are eval strings, expanded by ok()
# pull-marketplace.sh: fast-forwards the main checkout's main from origin and fires post-merge;
# throttled; leaves another branch, a worktree and a diverged main alone. Temp repos only.
set -u
script="$(cd "$(dirname "$0")/.." && pwd)/hooks/pull-marketplace.sh"
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
export HOME="$t" GIT_CONFIG_GLOBAL="$t/gitconfig" GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
git config --global init.defaultBranch main
pass=0 fail=0
ok() { if eval "$2"; then pass=$((pass+1)); echo "ok   $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }
git init -q --bare "$t/origin.git"
git clone -q "$t/origin.git" "$t/seed" 2>/dev/null
mkdir -p "$t/seed/scripts/git-hooks"
# a post-merge that records it ran, standing in for the real sync-plugins
printf '#!/bin/sh\necho ran >>"$(git rev-parse --git-dir)/merged"\n' >"$t/seed/scripts/git-hooks/post-merge"
cp "$t/seed/scripts/git-hooks/post-merge" "$t/seed/scripts/git-hooks/sync-plugins"
chmod +x "$t/seed/scripts/git-hooks/"*
git -C "$t/seed" add -A && git -C "$t/seed" commit -qm one && git -C "$t/seed" push -q origin main
git clone -q "$t/origin.git" "$t/m"
push() { echo "$1" >"$t/seed/f" && git -C "$t/seed" add f && git -C "$t/seed" commit -qm "$1" && git -C "$t/seed" push -q origin main; }
tip() { git -C "$1" rev-parse HEAD; }

push two
ok "clone starts behind origin" '[ "$(tip "$t/m")" != "$(tip "$t/seed")" ]'
bash "$script" "$t/m"
ok "fast-forwards a behind main" '[ "$(tip "$t/m")" = "$(tip "$t/seed")" ]'
ok "sets core.hooksPath when unset" '[ "$(git -C "$t/m" config core.hooksPath)" = scripts/git-hooks ]'
ok "post-merge ran" '[ -s "$t/m/.git/merged" ]'

push three
bash "$script" "$t/m"
ok "throttled within 10 minutes" '[ "$(tip "$t/m")" != "$(tip "$t/seed")" ]'
rm "$t/m/.git/plugin-rsync-pull.stamp"

git -C "$t/m" switch -qc feature
bash "$script" "$t/m"; rm -f "$t/m/.git/plugin-rsync-pull.stamp"
ok "another branch is left alone" '[ "$(git -C "$t/m" rev-parse main)" != "$(tip "$t/seed")" ]'
git -C "$t/m" switch -q main

git -C "$t/m" worktree add -q "$t/wt" -b wt 2>/dev/null
bash "$script" "$t/wt"
ok "a worktree is left alone" '[ "$(tip "$t/m")" != "$(tip "$t/seed")" ] && [ ! -e "$t/m/.git/plugin-rsync-pull.stamp" ]'

echo local >"$t/m/g" && git -C "$t/m" add g && git -C "$t/m" commit -qm local
before=$(tip "$t/m")
bash "$script" "$t/m"
ok "a diverged main is left alone" '[ "$(tip "$t/m")" = "$before" ]'

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] && [ "$pass" -eq 8 ]
