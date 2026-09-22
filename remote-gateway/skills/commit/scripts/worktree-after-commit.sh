#!/usr/bin/env bash
# Detect a linked git worktree and optionally merge + remove it after /commit.
# Usage:
#   worktree-after-commit.sh detect [dir]
#   worktree-after-commit.sh land   [dir]   # merge into main-checkout branch, then remove
#   worktree-after-commit.sh merge  [dir]
#   worktree-after-commit.sh cleanup [dir]
set -euo pipefail

cmd="${1:-detect}"
here="${2:-}"
if [[ -z "$here" ]]; then
  here="$(pwd)"
fi
if ! here="$(cd "$here" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "error=not a git work tree" >&2
  exit 2
fi

git_dir="$(git -C "$here" rev-parse --path-format=absolute --git-dir)"
common="$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)"
branch="$(git -C "$here" branch --show-current || true)"

main=""
if [[ "$(basename "$common")" == ".git" ]]; then
  main="$(dirname "$common")"
else
  main="$(cd "$common/.." 2>/dev/null && pwd || true)"
fi
if [[ -z "$main" || ! -d "$main" ]]; then
  # First porcelain block is the primary checkout.
  main="$(git -C "$here" worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
fi

linked=0
if [[ "$git_dir" != "$common" ]]; then
  linked=1
fi
if [[ -n "$main" && "$(cd "$here" && pwd)" != "$(cd "$main" && pwd)" ]]; then
  linked=1
fi

env_kind="git"
case "$here" in
  */.grok/worktrees/*) env_kind="grok" ;;
  */.claude/worktrees/*|*/.claude/*worktree*) env_kind="claude" ;;
  */.worktrees/*) env_kind="git-cwd" ;;
esac

main_branch=""
if [[ -n "$main" && -d "$main" ]]; then
  main_branch="$(git -C "$main" branch --show-current || true)"
fi

print_detect() {
  printf 'linked=%s\n' "$linked"
  printf 'path=%s\n' "$here"
  printf 'branch=%s\n' "${branch:-}"
  printf 'main=%s\n' "${main:-}"
  printf 'main_branch=%s\n' "${main_branch:-}"
  printf 'env=%s\n' "$env_kind"
  printf 'git_dir=%s\n' "$git_dir"
  printf 'git_common_dir=%s\n' "$common"
}

merge_into_main() {
  if [[ "$linked" != "1" ]]; then
    echo "not a linked worktree; nothing to merge" >&2
    exit 3
  fi
  if [[ -z "$branch" ]]; then
    echo "detached HEAD; refuse merge" >&2
    exit 4
  fi
  if [[ -z "$main" || -z "$main_branch" ]]; then
    echo "could not resolve main checkout branch" >&2
    exit 4
  fi
  if [[ "$branch" == "$main_branch" ]]; then
    echo "isolation branch equals main checkout branch ($branch); refuse" >&2
    exit 4
  fi
  if [[ -n "$(git -C "$here" status --porcelain)" ]]; then
    echo "worktree is dirty; commit or stash before merge" >&2
    git -C "$here" status -sb >&2
    exit 5
  fi
  echo "merging $branch → $main_branch (in $main)"
  git -C "$main" merge --no-edit "$branch"
}

cleanup_worktree() {
  if [[ "$linked" != "1" ]]; then
    echo "not a linked worktree; nothing to remove" >&2
    exit 3
  fi
  if [[ -z "$main" || "$(cd "$here" && pwd)" == "$(cd "$main" && pwd)" ]]; then
    echo "refuse to remove the main checkout" >&2
    exit 4
  fi
  echo "removing worktree $here"
  git -C "$main" worktree remove --force "$here"
  if [[ -n "$branch" ]] && git -C "$main" merge-base --is-ancestor "$branch" "$main_branch" 2>/dev/null; then
    git -C "$main" branch -d "$branch" 2>/dev/null || true
  fi
  if [[ "$env_kind" == "grok" ]] && command -v grok >/dev/null 2>&1; then
    grok worktree rm --force "$here" 2>/dev/null || grok worktree rm "$here" 2>/dev/null || true
  fi
  echo "switch_cwd=$main"
}

case "$cmd" in
  detect)
    print_detect
    ;;
  merge)
    merge_into_main
    ;;
  cleanup)
    cleanup_worktree
    ;;
  land)
    merge_into_main
    cleanup_worktree
    ;;
  *)
    echo "usage: $0 detect|merge|cleanup|land [dir]" >&2
    exit 2
    ;;
esac
