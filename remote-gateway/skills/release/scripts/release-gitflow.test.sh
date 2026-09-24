#!/usr/bin/env bash
# Isolated-repo tests for release-gitflow.sh (no live TeamCity / GitHub).
set -euo pipefail

RF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-gitflow.sh"
[[ -x "$RF" ]] || chmod +x "$RF"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok $*"; }

assert_human_cut() {
  local ver="$1" kind="${2:-release}"
  local who msg
  who="$(git log -1 --format='%an <%ae>' "$kind/v$ver")"
  [[ "$who" == "Ryan Helms <ryan@helms.ai>" ]] || fail "author=$who want Ryan Helms <ryan@helms.ai>"
  msg="$(git log -1 --format='%B' "$kind/v$ver")"
  echo "$msg" | grep -qiE 'Co-Authored-By|Generated-by|Assisted-by|Via Claude|Codex|Grok' && fail "agent trailer in commit" || true
}

assert_start_cut() {
  local ver="$1"
  local kind="${2:-release}"
  [[ "$(tr -d '[:space:]' <VERSION)" == "$ver" ]] || fail "VERSION=$(cat VERSION) want $ver"
  git rev-parse --abbrev-ref HEAD | grep -qx "$kind/v$ver" || fail "HEAD=$(git rev-parse --abbrev-ref HEAD) want $kind/v$ver"
  git rev-parse -q --verify "refs/tags/v$ver" >/dev/null || fail "missing tag v$ver"
  [[ "$(git cat-file -t "v$ver")" == "tag" ]] || fail "v$ver is not annotated"
  git merge-base --is-ancestor "v$ver" "$kind/v$ver" || fail "v$ver not on $kind/v$ver"
  if git merge-base --is-ancestor "v$ver" main; then
    fail "v$ver must NOT be on main until finish"
  fi
  git describe --tags --abbrev=0 | grep -qx "v$ver" || fail "describe=$(git describe --tags --abbrev=0)"
  grep -qE "^## \[${ver}\]" CHANGELOG.md || fail "changelog missing ## [$ver]"
  [[ -z "$(git status --porcelain)" ]] || fail "worktree dirty after start: $(git status --porcelain)"
  assert_human_cut "$ver" "$kind"
}

assert_finished_cut() {
  local ver="$1"
  git merge-base --is-ancestor "v$ver" main || fail "after finish, v$ver not on main"
  git merge-base --is-ancestor "v$ver" develop || fail "after finish, v$ver not on develop"
}

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/bdgw-release-XXXXXX")"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

seed_repo() {
  local dest="$1"
  git init -b main "$dest" >/dev/null
  cd "$dest"
  git config user.name "Ryan Helms"
  git config user.email "ryan@helms.ai"
  mkdir -p src
  printf '0.9.0\n' >VERSION
  cat >CHANGELOG.md <<'EOF'
# Changelog

## [Unreleased]

### Added

- feat(demo): **Something** — unreleased note

### Fixed

- fix(demo): a bug

## [0.9.0] - 2026-08-11

### Added

- feat(core): first release
EOF
  cp CHANGELOG.md src/embedded_changelog.md
  git add VERSION CHANGELOG.md src/embedded_changelog.md
  git commit -m "init" >/dev/null
  git branch develop
  git checkout develop >/dev/null
}

seed_repo "$WORKDIR/repo"

# finish on a feature branch must fail
git checkout -b feature/nope >/dev/null
if "$RF" finish --no-push >/dev/null 2>"$WORKDIR/finish-feature.err"; then
  fail "finish should refuse a feature branch"
fi
grep -q "finish only on release" "$WORKDIR/finish-feature.err" || fail "finish error text"
pass "finish refuses feature branch"
git checkout develop >/dev/null

# start on a dirty tree must fail
echo dirty >scratch
if "$RF" start >/dev/null 2>"$WORKDIR/start-dirty.err"; then
  fail "start should refuse dirty tree"
fi
grep -q "worktree dirty" "$WORKDIR/start-dirty.err" || fail "start dirty error text"
rm -f scratch
pass "start refuses dirty tree"

# start --no-push: commit + tag on the release branch; main stays untouched
"$RF" start --no-push >"$WORKDIR/start.out"
grep -q "skipped push" "$WORKDIR/start.out" || fail "start --no-push should skip push"
assert_start_cut 0.10.0
grep -q "feat(demo)" CHANGELOG.md || fail "unreleased notes not folded"
grep -q "## \[Unreleased\]" CHANGELOG.md || fail "Unreleased heading missing"
cmp -s CHANGELOG.md src/embedded_changelog.md || fail "embed not synced"
pass "start --no-push tags candidate without updating main"

# finish --no-push promotes onto main + develop
"$RF" finish --no-push >"$WORKDIR/finish.out"
assert_finished_cut 0.10.0
grep -q "promoted v0.10.0" "$WORKDIR/finish.out" || fail "finish should promote"
pass "finish --no-push merges candidate onto main and develop"

# finish again is a no-op
git checkout release/v0.10.0 >/dev/null
"$RF" finish --no-push >"$WORKDIR/finish-noop.out"
grep -q "already on main and develop" "$WORKDIR/finish-noop.out" || fail "finish should no-op after promote"
pass "finish is no-op after promote"

# finish refuses dirty tree
echo dirty >scratch
if "$RF" finish --no-push >/dev/null 2>"$WORKDIR/finish-dirty.err"; then
  fail "finish should refuse dirty tree"
fi
grep -q "worktree dirty" "$WORKDIR/finish-dirty.err" || fail "dirty error text"
rm -f scratch
pass "finish refuses dirty tree"

# hotfix from main bumps patch 0.10.0 → 0.10.1 (candidate only)
git checkout main >/dev/null
"$RF" hotfix --no-push >"$WORKDIR/hotfix.out"
assert_start_cut 0.10.1 hotfix
pass "hotfix --no-push tags candidate without updating main"

# start with explicit version from develop
git checkout develop >/dev/null
"$RF" start v1.2.3 --no-push >"$WORKDIR/start-explicit.out"
assert_start_cut 1.2.3
pass "start v1.2.3 --no-push honors explicit version"

"$RF" plan >/dev/null
pass "plan prints"

# start without origin and without --no-push must fail before mutating
git checkout develop >/dev/null
if "$RF" start v9.9.9 >/dev/null 2>"$WORKDIR/start-no-origin.err"; then
  fail "start should refuse when origin is missing"
fi
grep -q "no remote" "$WORKDIR/start-no-origin.err" || fail "start no-origin error text"
git rev-parse -q --verify refs/tags/v9.9.9 >/dev/null && fail "v9.9.9 should not exist" || true
pass "start refuses missing origin"

# Independent start launch 1 (0.9.0 → v0.10.0 candidate)
seed_repo "$WORKDIR/launch-1"
"$RF" start --no-push >"$WORKDIR/start-launch-1.raw"
assert_start_cut 0.10.0
{
  echo "repo=$WORKDIR/launch-1"
  echo "VERSION=$(tr -d '[:space:]' <VERSION)"
  echo "describe=$(git describe --tags --abbrev=0)"
  echo "author=$(git log -1 --format='%an <%ae>' release/v0.10.0)"
  echo "main_has_tag=$(git merge-base --is-ancestor v0.10.0 main && echo yes || echo no)"
} >"$WORKDIR/start-launch-1.txt"
grep -q "main_has_tag=no" "$WORKDIR/start-launch-1.txt" || fail "launch 1 must not merge main"
pass "independent start launch 1"

# Independent start launch 2
seed_repo "$WORKDIR/launch-2"
"$RF" start --no-push >"$WORKDIR/start-launch-2.raw"
assert_start_cut 0.10.0
{
  echo "repo=$WORKDIR/launch-2"
  echo "VERSION=$(tr -d '[:space:]' <VERSION)"
  echo "describe=$(git describe --tags --abbrev=0)"
  echo "author=$(git log -1 --format='%an <%ae>' release/v0.10.0)"
  echo "main_has_tag=$(git merge-base --is-ancestor v0.10.0 main && echo yes || echo no)"
} >"$WORKDIR/start-launch-2.txt"
grep -q "main_has_tag=no" "$WORKDIR/start-launch-2.txt" || fail "launch 2 must not merge main"
pass "independent start launch 2"

# start pushes branch + tag only (not main/develop)
git init --bare "$WORKDIR/origin.git" >/dev/null
seed_repo "$WORKDIR/push-repo"
git remote add origin "$WORKDIR/origin.git"
git push -u origin main develop >/dev/null
main_before="$(git rev-parse origin/main)"
"$RF" start >"$WORKDIR/start-push.out"
assert_start_cut 0.10.0
git ls-remote --heads origin "release/v0.10.0" | grep -q . || fail "origin missing release/v0.10.0"
git ls-remote --tags origin "v0.10.0" | grep -q . || fail "origin missing tag v0.10.0"
grep -q "pushed origin release/v0.10.0 v0.10.0" "$WORKDIR/start-push.out" || fail "start push log"
git fetch origin >/dev/null
[[ "$(git rev-parse origin/main)" == "$main_before" ]] || fail "start must not move origin/main"
if git merge-base --is-ancestor v0.10.0 origin/main; then
  fail "origin/main must not contain v0.10.0 until finish"
fi
pass "start pushes release branch and tag without updating main"

# Shipped URL helper + verify uses it
URL_TEST=""
_search="$RF"
while [[ -n "$_search" && "$_search" != "/" ]]; do
  if [[ -f "$_search/scripts/commercial/lib/release-url_test.sh" ]]; then
    URL_TEST="$_search/scripts/commercial/lib/release-url_test.sh"
    break
  fi
  if [[ -f "$_search/../bytedesk-remote-gateway/scripts/commercial/lib/release-url_test.sh" ]]; then
    URL_TEST="$(cd "$_search/../bytedesk-remote-gateway" && pwd)/scripts/commercial/lib/release-url_test.sh"
    break
  fi
  _search="$(dirname "$_search")"
done
[[ -n "$URL_TEST" && -f "$URL_TEST" ]] || fail "release-url_test.sh not found in the gateway checkout"
[[ -x "$URL_TEST" ]] || chmod +x "$URL_TEST"
"$URL_TEST" || fail "release-url helper"
grep -q 'bytedesk_gateway_release_url' "$RF" || fail "verify must call bytedesk_gateway_release_url"
grep -q 'bytedesk_desktop_release_url' "$RF" || fail "verify must call bytedesk_desktop_release_url"
grep -q 'bytedesk-gateway-desktop-linux-amd64' "$RF" || fail "verify must require desktop linux asset"
grep -q 'bytedesk-gateway-desktop-windows-amd64.exe' "$RF" || fail "verify must require desktop windows asset"
pass "verify uses /release/gateway and /release/gateway-desktop helpers"

echo "all tests passed"
