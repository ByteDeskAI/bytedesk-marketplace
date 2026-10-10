#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2034 # assertions are eval strings, expanded by ok()
# pull-marketplace.sh: fast-forwards the main checkout's main from origin and fires post-merge;
# throttled; leaves another branch, a worktree and a diverged main alone; never syncs or overwrites
# uncommitted plugin edits. Temp repos only.
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

mkdir -p "$t/bin" "$t/m/plugin-rsync/bin"
printf '#!/bin/sh\n' >"$t/bin/codex"; printf '#!/bin/sh\necho "$*" >>"%s/node.log"\n' "$t" >"$t/bin/node"; chmod +x "$t/bin/"*
export PATH="$t/bin:$PATH"
push two
ok "clone starts behind origin" '[ "$(tip "$t/m")" != "$(tip "$t/seed")" ]'
bash "$script" "$t/m"
ok "fast-forwards a behind main" '[ "$(tip "$t/m")" = "$(tip "$t/seed")" ]'
ok "sets core.hooksPath when unset" '[ "$(git -C "$t/m" config core.hooksPath)" = scripts/git-hooks ]'
ok "post-merge ran" '[ -s "$t/m/.git/merged" ]'
ok "first setup trusts Codex hooks" 'grep -q "plugin-rsync trust-codex-hooks" "$t/node.log"'

push three
bash "$script" "$t/m"
ok "throttled within 10 minutes" '[ "$(tip "$t/m")" != "$(tip "$t/seed")" ]'
rm "$t/m/.git/plugin-rsync-pull.stamp"

git -C "$t/m" switch -qc feature
feat=$(git -C "$t/m" rev-parse feature)
bash "$script" "$t/m"; rm -f "$t/m/.git/plugin-rsync-pull.stamp"
ok "another branch is left alone" '[ "$(git -C "$t/m" rev-parse feature)" = "$feat" ] && [ "$(git -C "$t/m" rev-parse main)" != "$(tip "$t/seed")" ]'

# a worktree with main checked out (the main checkout stays on feature)
git -C "$t/m" worktree add -q "$t/wt" main 2>/dev/null
bash "$script" "$t/wt"
ok "a worktree on main is left alone" '[ "$(tip "$t/wt")" != "$(tip "$t/seed")" ] && [ ! -e "$t/m/.git/plugin-rsync-pull.stamp" ]'
git -C "$t/m" worktree remove "$t/wt"
git -C "$t/m" switch -q main

echo local >"$t/m/g" && git -C "$t/m" add g && git -C "$t/m" commit -qm local
before=$(tip "$t/m")
bash "$script" "$t/m"
ok "a diverged main is left alone" '[ "$(tip "$t/m")" = "$before" ]'

# Dirty trees, with the real post-merge/sync-plugins and a plugin-rsync stand-in that copies each
# plugin it is given into $CACHE, as the real one copies the working tree into the installed caches.
export CACHE="$t/cache"
real="$(cd "$(dirname "$0")/../.." && pwd)/scripts/git-hooks"
git init -q --bare "$t/o2.git"
git clone -q "$t/o2.git" "$t/s2" 2>/dev/null
mkdir -p "$t/s2/scripts/git-hooks" "$t/s2/plugin-rsync/bin"
cp "$real/post-merge" "$real/sync-plugins" "$t/s2/scripts/git-hooks/"
cat >"$t/s2/plugin-rsync/bin/plugin-rsync" <<'EOF2'
#!/bin/sh
for p in $(echo "$1" | tr , ' '); do mkdir -p "$CACHE/$p" && cp -R "$BYTEDESK_MARKETPLACE/$p/." "$CACHE/$p/"; done
touch "$CACHE.done"
EOF2
chmod +x "$t/s2/plugin-rsync/bin/plugin-rsync"
for p in p q; do mkdir -p "$t/s2/$p/.claude-plugin" && echo '{}' >"$t/s2/$p/.claude-plugin/plugin.json" && echo 0 >"$t/s2/$p/a" && echo 0 >"$t/s2/$p/b"; done
git -C "$t/s2" add -A && git -C "$t/s2" commit -qm base && git -C "$t/s2" push -q origin main
git clone -q "$t/o2.git" "$t/m2"
push2() { for f in "${@:2}"; do echo "$1" >"$t/s2/$f"; done; git -C "$t/s2" commit -qam "$1" && git -C "$t/s2" push -q origin main; }
stamp2="$t/m2/.git/plugin-rsync-pull.stamp"

push2 one p/a q/a
bash "$script" "$t/m2" setup-only
ok "setup-only sets core.hooksPath and does not pull" '[ "$(git -C "$t/m2" config core.hooksPath)" = scripts/git-hooks ] && [ "$(tip "$t/m2")" != "$(tip "$t/s2")" ]'

# another session's half-finished edit in p, which the incoming commit also touches (in p/a)
echo DIRTY >"$t/m2/p/b"
bash "$script" "$t/m2"
for _ in $(seq 50); do [ -e "$CACHE.done" ] && break; sleep 0.1; done
ok "pulls past a dirty file it does not touch" '[ "$(tip "$t/m2")" = "$(tip "$t/s2")" ]'
ok "the clean touched plugin is synced" '[ "$(cat "$CACHE/q/a" 2>/dev/null)" = one ]'
ok "the dirty plugin never reaches the cache" '[ ! -e "$CACHE/p" ] && ! grep -rqs DIRTY "$CACHE"'
ok "the skip is logged" 'grep -q "skip p: uncommitted changes" "$t/m2/.git/plugin-rsync.log"'
ok "stamp written after a successful pull" '[ -e "$stamp2" ]'
git -C "$t/m2" checkout -q -- p/b; rm "$stamp2"

# an incoming commit that touches a dirty file: git's --ff-only refusal is the protection
echo MINE >"$t/m2/p/a"
before=$(tip "$t/m2")
push2 two p/a
bash "$script" "$t/m2"
ok "a pull over a dirty file leaves the tip" '[ "$(tip "$t/m2")" = "$before" ]'
ok "a pull over a dirty file leaves the file" '[ "$(cat "$t/m2/p/a")" = MINE ]'
ok "the failed pull is logged" 'grep -q "auto-pull failed" "$t/m2/.git/plugin-rsync.log"'
ok "no stamp after a failed pull, so the next session retries" '[ ! -e "$stamp2" ]'

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] && [ "$pass" -eq 19 ]
