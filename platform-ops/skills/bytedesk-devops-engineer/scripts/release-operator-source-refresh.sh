#!/usr/bin/env bash
set -euo pipefail

platform_repo="${1:-${BYTEDESK_PLATFORM_REPO:-$(pwd)}}"

if ! git -C "$platform_repo" rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "Platform repo not found at $platform_repo" >&2
  exit 1
fi

cd "$platform_repo"
git fetch --all --prune --tags --force

echo "release-operator source refresh: ok"
echo "branch: $(git branch --show-current || true)"
echo "head: $(git rev-parse --short=12 HEAD)"
echo "origin/develop: $(git rev-parse --short=12 --verify origin/develop)"
echo "origin/main: $(git rev-parse --short=12 --verify origin/main)"
git status --short --branch
