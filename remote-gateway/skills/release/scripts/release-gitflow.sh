#!/usr/bin/env bash
# Gitflow release/hotfix + Releaseflow verify for bytedesk-remote-gateway.
# Self-contained: do not call monorepo scripts/commercial/*.
set -euo pipefail

ORIGIN="${ORIGIN:-origin}"
GET_ORIGIN="${BYTEDESK_GET_ORIGIN:-https://get.bytedesk.ai}"
USAGE="usage: release-gitflow.sh status|start [vX.Y.Z] [--no-push]|hotfix [vX.Y.Z] [--no-push]|finish [--no-push]|verify [vX.Y.Z]|plan"

die() { echo "release-gitflow: $*" >&2; exit 1; }
log() { echo "release-gitflow: $*"; }

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

find_repo_root() {
  local d start
  for start in "$(pwd)" "$script_dir"; do
    d="$start"
    while [[ -n "$d" && "$d" != "/" ]]; do
      if [[ -f "$d/VERSION" && -f "$d/CHANGELOG.md" && -f "$d/src/main.go" ]]; then
        printf '%s\n' "$d"
        return 0
      fi
      d="$(dirname "$d")"
    done
  done
  return 1
}

require_identity() {
  local name email
  name="$(git config user.name || true)"
  email="$(git config user.email || true)"
  [[ -n "$name" && -n "$email" ]] || die "set git config user.name and user.email (human identity only)"
  log "identity=$name <$email>"
}

strip_v() {
  local v="${1:-}"
  v="${v#v}"
  printf '%s\n' "$v"
}

valid_semver() {
  [[ "${1:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

read_version_file() {
  local raw
  raw="$(tr -d '[:space:]' <"$ROOT/VERSION" 2>/dev/null || true)"
  raw="$(strip_v "$raw")"
  valid_semver "$raw" || die "invalid VERSION: ${raw:-<empty>}"
  printf '%s\n' "$raw"
}

bump_minor() {
  local major minor patch
  IFS=. read -r major minor patch <<<"$1"
  printf '%s.%s.0\n' "$major" "$((minor + 1))"
}

bump_patch() {
  local major minor patch
  IFS=. read -r major minor patch <<<"$1"
  printf '%s.%s.%s\n' "$major" "$minor" "$((patch + 1))"
}

current_branch() {
  git rev-parse --abbrev-ref HEAD
}

branch_kind() {
  # prints "release|hotfix" and sets RELE_VER from branch name
  local b
  b="$(current_branch)"
  case "$b" in
    release/v*)
      RELE_KIND=release
      RELE_VER="$(strip_v "${b#release/}")"
      ;;
    hotfix/v*)
      RELE_KIND=hotfix
      RELE_VER="$(strip_v "${b#hotfix/}")"
      ;;
    *)
      return 1
      ;;
  esac
  valid_semver "$RELE_VER" || return 1
  return 0
}

fold_changelog() {
  local ver="$1"
  local day
  day="$(date -u +%Y-%m-%d)"
  python3 - "$ROOT/CHANGELOG.md" "$ver" "$day" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
ver, day = sys.argv[2], sys.argv[3]
text = path.read_text()
start = text.find("## [Unreleased]")
if start < 0:
    sys.exit("CHANGELOG.md missing ## [Unreleased]")
rest = text[start + len("## [Unreleased]"):]
# next version heading
idx = 0
# skip leading newlines then find next ## [
nl = 0
while nl < len(rest) and rest[nl] == "\n":
    nl += 1
body_and_after = rest[nl:]
next_h = body_and_after.find("\n## [")
if next_h < 0:
    body = body_and_after.rstrip() + "\n"
    after = ""
else:
    body = body_and_after[:next_h].rstrip() + "\n"
    after = body_and_after[next_h + 1:]  # starts with ## [
# drop empty-only body (headings with no bullets)
meaningful = any(
    line.startswith("- ") or line.startswith("* ")
    for line in body.splitlines()
)
if not meaningful:
    body = "_No unreleased notes folded._\n"
prefix = text[:start]
new = (
    prefix
    + "## [Unreleased]\n\n### Added\n\n### Changed\n\n### Fixed\n\n"
    + f"## [{ver}] - {day}\n\n"
    + body
    + ("\n" if after else "")
    + after
)
path.write_text(new)
PY
}

sync_embed() {
  if [[ -d "$ROOT/src" ]]; then
    cp "$ROOT/CHANGELOG.md" "$ROOT/src/embedded_changelog.md"
  fi
}

require_changelog_version() {
  local ver="$1"
  grep -qE "^## \[${ver}\]" "$ROOT/CHANGELOG.md" || die "CHANGELOG.md missing ## [$ver]"
}

require_embed_sync() {
  [[ -f "$ROOT/src/embedded_changelog.md" ]] || return 0
  cmp -s "$ROOT/CHANGELOG.md" "$ROOT/src/embedded_changelog.md" || die "src/embedded_changelog.md out of sync — cp CHANGELOG.md src/embedded_changelog.md"
}

require_clean() {
  local dirty
  dirty="$(git status --porcelain)"
  [[ -z "$dirty" ]] || die "worktree dirty; commit or stash first"
}

has_origin() {
  git remote get-url "$ORIGIN" >/dev/null 2>&1
}

fetch_origin() {
  has_origin || return 0
  git fetch "$ORIGIN" --tags --prune 2>/dev/null || git fetch "$ORIGIN" --tags || true
}

parse_prepare_args() {
  PREPARE_VER=""
  PREPARE_NO_PUSH=0
  local arg
  for arg in "$@"; do
    case "$arg" in
      --no-push) PREPARE_NO_PUSH=1 ;;
      -*) die "unknown flag: $arg" ;;
      *)
        [[ -z "$PREPARE_VER" ]] || die "unexpected extra argument: $arg"
        PREPARE_VER="$arg"
        ;;
    esac
  done
}

commit_version_cut() {
  local kind="$1" ver="$2"
  git add -- VERSION CHANGELOG.md
  if [[ -f "$ROOT/src/embedded_changelog.md" ]]; then
    git add -- src/embedded_changelog.md
  fi
  git commit -m "$(cat <<EOF
chore($kind): v$ver

Prepare VERSION and changelog for v$ver.
EOF
)"
  log "committed chore($kind): v$ver"
}

# Tag the VERSION commit on the release/hotfix line. TeamCity triggers on v*.
# Do not merge main here — that waits for verify + finish.
tag_candidate() {
  local ver="$1"
  if git rev-parse -q --verify "refs/tags/v$ver" >/dev/null; then
    die "tag already exists: v$ver"
  fi
  git tag -a "v$ver" -m "v$ver"
  log "tagged v$ver on $(current_branch)"
}

push_candidate() {
  local branch="$1" ver="$2" no_push="${3:-0}"
  if [[ "$no_push" -eq 1 ]]; then
    log "skipped push (--no-push)"
    return 0
  fi
  has_origin || die "no remote $ORIGIN; pass --no-push or add the remote"
  git push -u "$ORIGIN" "$branch"
  git push "$ORIGIN" "v$ver"
  log "pushed $ORIGIN $branch v$ver"
}

open_main_pr() {
  local branch="$1" ver="$2" no_push="${3:-0}"
  if [[ "$no_push" -eq 1 ]]; then
    log "skipped PR (--no-push)"
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    log "skipped PR (gh not installed); open $branch → main after verify"
    return 0
  fi
  if gh pr view "$branch" --json url >/dev/null 2>&1; then
    log "PR already open for $branch"
    gh pr view "$branch" --json url -q .url || true
    return 0
  fi
  if ! gh pr create --base main --head "$branch" \
    --title "release: v$ver" \
    --body "$(cat <<EOF
Candidate **v$ver**.

Tag \`v$ver\` is on this branch so TeamCity \`release-*\` / \`release-publish\` can run.

**Do not merge until** \`/release verify v$ver\` PASSes (CDN + published GitHub Release). Then \`/release finish\` merges this PR into \`main\` and back-merges \`develop\`.
EOF
)"; then
    log "skipped PR (gh pr create failed); open $branch → main after verify"
    return 0
  fi
  log "opened PR $branch → main"
}

# Promote a verified candidate: merge into main, back-merge develop. Tag already exists.
merge_main_and_develop() {
  local kind="$1" ver="$2" branch="$3"
  git checkout main
  if has_origin && git show-ref --verify --quiet "refs/remotes/$ORIGIN/main"; then
    git pull --ff-only "$ORIGIN" main
  fi
  git merge --no-ff "$branch" -m "merge($kind): $branch"
  [[ "$(current_branch)" == main ]] || die "expected to be on main after merge"
  git checkout develop
  if has_origin && git show-ref --verify --quiet "refs/remotes/$ORIGIN/develop"; then
    git pull --ff-only "$ORIGIN" develop
  fi
  git merge --no-ff "$branch" -m "merge($kind): $branch into develop"
  git checkout "$branch"
  log "merged $branch into main and develop"
}

already_shipped() {
  local ver="$1"
  git rev-parse -q --verify "refs/tags/v$ver" >/dev/null || return 1
  git merge-base --is-ancestor "v$ver" main || return 1
  git merge-base --is-ancestor "v$ver" develop || return 1
  return 0
}

cmd_status() {
  local ver branch tag
  ver="$(read_version_file)"
  branch="$(current_branch)"
  tag="$(git describe --tags --abbrev=0 2>/dev/null || true)"
  echo "repo=$ROOT"
  echo "branch=$branch"
  echo "VERSION=$ver"
  echo "latest_tag=${tag:-<none>}"
  if branch_kind; then
    echo "release_branch=$RELE_KIND/v$RELE_VER"
  fi
  if command -v gh >/dev/null 2>&1; then
    gh release view "v$ver" --json tagName,isDraft,url 2>/dev/null || echo "gh_release=missing v$ver"
  else
    echo "gh=not-installed"
  fi
  if curl -fsSI -o /tmp/bdgw-cdn-amd64.hdr -w "cdn_amd64=%{http_code}\n" \
    "$GET_ORIGIN/releases/latest/bytedesk-gateway-linux-amd64"; then
    :
  else
    echo "cdn_amd64=fail"
  fi
}

prepare_line() {
  local kind="$1" # release|hotfix
  shift
  parse_prepare_args "$@"
  local requested="$PREPARE_VER"
  local no_push="$PREPARE_NO_PUSH"
  local base ver branch
  require_identity
  require_clean
  if [[ "$no_push" -eq 0 ]]; then
    has_origin || die "no remote $ORIGIN; pass --no-push or add the remote"
  fi
  if [[ "$kind" == hotfix ]]; then
    base=main
  else
    base=develop
  fi
  fetch_origin
  git checkout "$base"
  if has_origin && git show-ref --verify --quiet "refs/remotes/$ORIGIN/$base"; then
    git pull --ff-only "$ORIGIN" "$base"
  fi
  if [[ -n "$requested" ]]; then
    ver="$(strip_v "$requested")"
  elif [[ "$kind" == hotfix ]]; then
    ver="$(bump_patch "$(read_version_file)")"
  else
    ver="$(bump_minor "$(read_version_file)")"
  fi
  valid_semver "$ver" || die "invalid version: $ver"
  branch="$kind/v$ver"
  if git show-ref --verify --quiet "refs/heads/$branch" \
    || git show-ref --verify --quiet "refs/remotes/$ORIGIN/$branch"; then
    die "branch already exists: $branch"
  fi
  if git rev-parse -q --verify "refs/tags/v$ver" >/dev/null; then
    die "tag already exists: v$ver"
  fi
  git checkout -b "$branch"
  printf '%s\n' "$ver" >"$ROOT/VERSION"
  fold_changelog "$ver"
  sync_embed
  require_changelog_version "$ver"
  commit_version_cut "$kind" "$ver"
  tag_candidate "$ver"
  push_candidate "$branch" "$ver" "$no_push"
  open_main_pr "$branch" "$ver" "$no_push"
  log "candidate $branch VERSION=$ver tag=v$ver (main not updated)"
  echo "next: TeamCity release-amd64 + release-arm64 + release-windows-amd64 → release-publish; /release verify v$ver; then /release finish to merge main + develop"
}

cmd_finish() {
  local no_push=0 skip_verify=0 arg
  for arg in "$@"; do
    case "$arg" in
      --no-push) no_push=1 ;;
      --no-verify) skip_verify=1 ;;
      "") ;;
      *) die "unknown finish flag: $arg" ;;
    esac
  done
  require_identity
  branch_kind || die "finish only on release/vX.Y.Z or hotfix/vX.Y.Z (now: $(current_branch))"
  local file_ver src_branch
  file_ver="$(read_version_file)"
  [[ "$file_ver" == "$RELE_VER" ]] || die "VERSION=$file_ver but branch is $RELE_KIND/v$RELE_VER"
  require_changelog_version "$RELE_VER"
  require_embed_sync
  require_clean
  src_branch="$RELE_KIND/v$RELE_VER"
  if already_shipped "$RELE_VER"; then
    log "v$RELE_VER already on main and develop; finish is a no-op"
    echo "next: /cutover on dev if not done"
    return 0
  fi
  if [[ "$no_push" -eq 0 && "$skip_verify" -eq 0 ]]; then
    cmd_verify "$RELE_VER" || die "verify failed; will not merge $src_branch into main"
  fi
  fetch_origin
  merge_main_and_develop "$RELE_KIND" "$RELE_VER" "$src_branch"
  if [[ "$no_push" -eq 0 ]]; then
    has_origin || die "no remote $ORIGIN; pass --no-push or add the remote"
    git push "$ORIGIN" main develop
    if command -v gh >/dev/null 2>&1; then
      gh pr merge "$src_branch" --merge --auto 2>/dev/null || true
    fi
  else
    log "skipped push (--no-push)"
  fi
  log "promoted v$RELE_VER onto main and develop"
  echo "next: /cutover on dev (https://gateway.dev.bytedesk.ai/healthz); prod only if the operator asked"
}

cmd_verify() {
  local ver rc=0
  if [[ -n "${1:-}" ]]; then
    ver="$(strip_v "$1")"
  else
    ver="$(read_version_file)"
  fi
  valid_semver "$ver" || die "invalid version: $ver"
  echo "verify v$ver"
  echo "teamcity=https://deploy.prod.bytedesk.ai  (release-amd64 / release-arm64 / release-windows-amd64 / release-publish)  server=gateway"
  echo "gha=release-core.yml desktop linux-amd64+windows-amd64  client=gateway-desktop"
  # shellcheck source=../../../../scripts/commercial/lib/release-url.sh
  if [[ -f "$ROOT/scripts/commercial/lib/release-url.sh" ]]; then
    # shellcheck disable=SC1091
    source "$ROOT/scripts/commercial/lib/release-url.sh"
  else
    die "missing scripts/commercial/lib/release-url.sh"
  fi
  local plat arch code url
  for spec in "linux amd64" "linux arm64" "windows amd64"; do
    # shellcheck disable=SC2086
    set -- $spec
    plat="$1"
    arch="$2"
    url="$(bytedesk_gateway_release_url "$GET_ORIGIN" "$plat" "$arch" "$ver")"
    code="$(curl -fsSIL -o /dev/null -w '%{http_code}' "$url" || true)"
    echo "cdn_${plat}_${arch}=${code:-fail} $url"
    [[ "$code" == "200" ]] || rc=1
  done
  for spec in "linux amd64" "windows amd64"; do
    # shellcheck disable=SC2086
    set -- $spec
    plat="$1"
    arch="$2"
    url="$(bytedesk_desktop_release_url "$GET_ORIGIN" "$plat" "$arch" "$ver")"
    code="$(curl -fsSIL -o /dev/null -w '%{http_code}' "$url" || true)"
    echo "cdn_desktop_${plat}_${arch}=${code:-fail} $url"
    [[ "$code" == "200" ]] || rc=1
  done
  if command -v gh >/dev/null 2>&1; then
    if gh release view "v$ver" --json tagName,isDraft,url,assets >/tmp/bdgw-gh-rel.json; then
      if python3 -c '
import json, pathlib, sys
d = json.loads(pathlib.Path("/tmp/bdgw-gh-rel.json").read_text())
print("gh_release={tagName} draft={isDraft} url={url}".format(**d))
if d.get("isDraft"):
    sys.exit(1)
names = {a.get("name") for a in (d.get("assets") or [])}
need = (
    "bytedesk-gateway-desktop-linux-amd64",
    "bytedesk-gateway-desktop-windows-amd64.exe",
)
missing = [n for n in need if n not in names]
if missing:
    print("gh_release_missing_desktop=" + ",".join(missing))
    sys.exit(1)
'; then
        :
      else
        echo "gh_release=draft-or-unreadable-or-missing-desktop"
        rc=1
      fi
    else
      echo "gh_release=missing v$ver"
      rc=1
    fi
  else
    echo "gh=not-installed (install gh to verify GitHub Release)"
    rc=1
  fi
  if [[ "$rc" -ne 0 ]]; then
    echo "verify FAIL — do not claim shipped; wait for TeamCity server + GHA desktop publish (do not laptop-upload)"
    exit 1
  fi
  echo "verify PASS v$ver"
  echo "next: /cutover on dev (https://gateway.dev.bytedesk.ai/healthz); prod only if the operator asked"
}

cmd_plan() {
  cat <<EOF
# From repo root, skill script:
RF=$script_dir/release-gitflow.sh

# Status (no writes)
"\$RF" status

# Candidate kickoff (default: bump minor of VERSION):
# commit VERSION/changelog, annotated tag vX.Y.Z on the release branch,
# push branch + tag (TeamCity starts), open PR → main. Does NOT update main.
"\$RF" start            # or: "\$RF" start vX.Y.Z
# --no-push: local commit + tag only

# Or hotfix (default: bump patch)
"\$RF" hotfix

# After verify PASS: merge PR into main and back-merge develop
"\$RF" finish

# Prove artifacts (TeamCity must have published after the v* push)
"\$RF" verify

# Host process (dev first) — cutover skill, scripts/deploy-safe.sh next to that SKILL.md
# "$CUTOVER_DIR/scripts/deploy-safe.sh" preflight && stage && restart-cutover
EOF
}

ROOT="$(find_repo_root)" || die "not inside a gateway repo (need VERSION + CHANGELOG.md + .git)"
cd "$ROOT"

cmd="${1:-status}"
shift || true
case "$cmd" in
  status) cmd_status ;;
  start) prepare_line release "$@" ;;
  hotfix) prepare_line hotfix "$@" ;;
  finish) cmd_finish "$@" ;;
  verify) cmd_verify "${1:-}" ;;
  plan|dry-run) cmd_plan ;;
  -h|--help|help) echo "$USAGE" ;;
  *) die "$USAGE" ;;
esac
