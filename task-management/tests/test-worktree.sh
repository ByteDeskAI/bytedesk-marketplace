#!/usr/bin/env bash
# Worktree lifecycle against real git: create, list, refuse, remove.
# Real repos only — worktree logic tested against mocks is worthless.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TM_ROOT="$(mktemp -d)"
REMOTE="$(mktemp -d)"
export TM_ROOT PLUGIN_ROOT
# The name Claude Code actually sets. The suites used to export CLAUDE_SESSION_ID, which
# nothing sets — so every session-dependent path was exercised with a variable production
# never had, and 9 suites stayed green while claims, gates and attribution were all inert.
export CLAUDE_CODE_SESSION_ID="test-session"
trap 'rm -rf "$TM_ROOT" "$REMOTE"' EXIT

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) ok "$3" ;; *) no "$3" "expected: $2 | got: ${1:0:300}" ;; esac; }
hasnt() { case "$1" in *"$2"*) no "$3" "did not expect: $2 | got: ${1:0:300}" ;; *) ok "$3" ;; esac; }
# Runs an ESM snippet (read from stdin) against the plugin's libs. $TM_ROOT is the main checkout.
run() { node --input-type=module -e "$(cat)" 2>&1; }

echo "test-worktree"

# ── a main checkout with unshareable-by-hand artifacts ───────────────────────
git init -q "$TM_ROOT"
git -C "$TM_ROOT" config user.email test@example.com
git -C "$TM_ROOT" config user.name Test
git -C "$TM_ROOT" config commit.gpgsign false
printf 'node_modules/\n.env\n' > "$TM_ROOT/.gitignore"
printf '# app\n' > "$TM_ROOT/README.md"
git -C "$TM_ROOT" add .
git -C "$TM_ROOT" commit -qm init
mkdir -p "$TM_ROOT/node_modules"
printf 'installed once\n' > "$TM_ROOT/node_modules/marker.txt"
printf 'TOKEN=main\n' > "$TM_ROOT/.env"
git init -q --bare "$REMOTE/origin.git"
git -C "$TM_ROOT" remote add origin "$REMOTE/origin.git"
git -C "$TM_ROOT" push -q origin HEAD

# ── create ───────────────────────────────────────────────────────────────────
OUT="$(run <<'JS'
const lib = (m) => import(`${process.env.PLUGIN_ROOT}/lib/${m}.mjs`);
const { paths } = await lib("paths");
const { create } = await lib("store");
const { createWorktree } = await lib("worktree");
const p = paths(process.env.TM_ROOT);
const task = create("task", { title: "Ship the thing" }, "", p);
const res = createWorktree(task, { base: "HEAD", p });
console.log(JSON.stringify(res));
JS
)"
has "$OUT" '"branch":"tm/TM-001-ship-the-thing"' "createWorktree opens the tm/ branch"
WT="$TM_ROOT/.bytedesk/worktrees/TM-001-ship-the-thing"
[[ -d "$WT" ]] && ok "the worktree directory exists" || no "the worktree directory exists" "$OUT"
[[ "$(git -C "$WT" rev-parse --abbrev-ref HEAD)" == "tm/TM-001-ship-the-thing" ]] &&
  ok "the worktree is on its own branch" || no "the worktree is on its own branch"

# ── the space saving, proven ─────────────────────────────────────────────────
[[ -L "$WT/node_modules" ]] && ok "node_modules is a symlink, not a copy" || no "node_modules is a symlink, not a copy"
has "$(cat "$WT/node_modules/marker.txt")" "installed once" "the symlink resolves to the main checkout's install"
[[ -f "$WT/.env" && ! -L "$WT/.env" ]] && ok ".env is a real copy, so edits stay local" || no ".env is a real copy, so edits stay local"
[[ -z "$(git -C "$WT" status --porcelain)" ]] && ok "shares leave the worktree clean" || no "shares leave the worktree clean" "$(git -C "$WT" status --porcelain)"

# ── list ─────────────────────────────────────────────────────────────────────
LIST="$(run <<'JS'
const lib = (m) => import(`${process.env.PLUGIN_ROOT}/lib/${m}.mjs`);
const { paths } = await lib("paths");
const { listWorktrees } = await lib("worktree");
console.log(JSON.stringify(listWorktrees(paths(process.env.TM_ROOT))));
JS
)"
has "$LIST" '"taskId":"TM-001"' "list joins a worktree back to its task"
has "$LIST" '"dirty":false' "a fresh worktree is not dirty"
has "$LIST" '"exists":true' "list reports the directory is there"
hasnt "$LIST" "$(cd "$TM_ROOT" && pwd -P)\"" "list omits the main checkout"

# ── refusals ─────────────────────────────────────────────────────────────────
remove() { # <json-opts>
  OPTS="$1" run <<'JS'
const lib = (m) => import(`${process.env.PLUGIN_ROOT}/lib/${m}.mjs`);
const { paths } = await lib("paths");
const { read } = await lib("store");
const { removeWorktree } = await lib("worktree");
const p = paths(process.env.TM_ROOT);
console.log(JSON.stringify(removeWorktree(read("TM-001", p), { p, ...JSON.parse(process.env.OPTS) })));
JS
}

printf '# edited\n' >> "$WT/README.md"
OUT="$(remove '{}')"
has "$OUT" "uncommitted" "a dirty worktree is refused"
[[ -d "$WT" ]] && ok "the refused worktree is still there" || no "the refused worktree is still there"
[[ -L "$WT/node_modules" ]] && ok "a refusal restores the shares it unlinked" || no "a refusal restores the shares it unlinked"

git -C "$WT" commit -qam "local work"
OUT="$(remove '{}')"
has "$OUT" "unpushed" "an unpushed commit is refused"

# ── remove ───────────────────────────────────────────────────────────────────
OUT="$(remove '{"force":true}')"
has "$OUT" '"removed":true' "--force removes it anyway"
[[ ! -d "$WT" ]] && ok "the worktree directory is gone" || no "the worktree directory is gone"
has "$(cat "$TM_ROOT/node_modules/marker.txt")" "installed once" "removing a worktree never reaches through the symlink"
has "$(cat "$TM_ROOT/.env")" "TOKEN=main" "the main checkout's .env survives"
hasnt "$(git -C "$TM_ROOT" worktree list)" "TM-001" "git no longer tracks the worktree"

# Recreating resumes the existing branch; once its commits are pushed, nothing blocks removal.
git -C "$TM_ROOT" push -q origin tm/TM-001-ship-the-thing
run <<'JS' >/dev/null
const lib = (m) => import(`${process.env.PLUGIN_ROOT}/lib/${m}.mjs`);
const { paths } = await lib("paths");
const { read } = await lib("store");
const { createWorktree } = await lib("worktree");
const p = paths(process.env.TM_ROOT);
createWorktree(read("TM-001", p), { base: "HEAD", p });
JS
OUT="$(remove '{}')"
has "$OUT" '"removed":true' "a clean worktree removes without force"
[[ ! -d "$WT" ]] && ok "the clean worktree is gone" || no "the clean worktree is gone"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
