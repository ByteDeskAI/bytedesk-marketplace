#!/usr/bin/env bash
set -euo pipefail

platform_repo="${1:-${BYTEDESK_PLATFORM_REPO:-$(pwd)}}"

if [[ ! -d "$platform_repo/.git" ]]; then
  echo "Platform repo not found at $platform_repo" >&2
  exit 1
fi

cd "$platform_repo"
node scripts/prod-deploy-tui.mjs --capabilities-json