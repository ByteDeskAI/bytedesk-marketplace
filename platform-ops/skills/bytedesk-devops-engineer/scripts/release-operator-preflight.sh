#!/usr/bin/env bash
set -euo pipefail

platform_repo="${1:-${BYTEDESK_PLATFORM_REPO:-$(pwd)}}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! git -C "$platform_repo" rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "Platform repo not found at $platform_repo" >&2
  exit 1
fi

if command -v release-operator-toolchain-check >/dev/null 2>&1; then
  release-operator-toolchain-check
else
  echo "release-operator-toolchain-check not found; assuming this is a local non-sandbox run." >&2
fi

cd "$platform_repo"
"$script_dir/release-operator-source-refresh.sh" "$platform_repo"
node scripts/deploy/infisical-deploy-env.mjs
node scripts/prod-deploy-tui.mjs --capabilities-json > /tmp/bytedesk-deploy-tui-capabilities.json

echo "release-operator preflight: ok"
echo "capabilities: /tmp/bytedesk-deploy-tui-capabilities.json"
echo "runtime env: $platform_repo/.deploy-secrets/release-operator.env"
echo "load with: set -a; source .deploy-secrets/release-operator.env; set +a"
git status --short --branch
