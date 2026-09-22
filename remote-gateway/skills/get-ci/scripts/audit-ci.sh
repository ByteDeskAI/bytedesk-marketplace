#!/usr/bin/env bash
# Audit this checkout against the get.bytedesk.ai TeamCity/R2 publish contract.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fail=0
say() { echo "get-ci: $*" >&2; }
gap() { say "GAP: $*"; fail=1; }

if [[ ! -d "$ROOT/.teamcity" ]]; then
  gap "no .teamcity/ — add release-amd64/arm64/windows + release-publish that call publish-r2.sh"
else
  say "found .teamcity/"
  if ! rg -q 'publish-r2' "$ROOT/.teamcity" 2>/dev/null; then
    gap ".teamcity does not call publish-r2.sh"
  fi
  if rg -n 'artifactRules' "$ROOT/.teamcity" | rg -q 'bytedesk-.*-linux|dist/\*\*'; then
    if ! rg -q 'cleanup-tc-binaries|artifacts\(builds = 1\)' "$ROOT/.teamcity"; then
      gap "TeamCity still keeps cores (artifactRules list binaries) without mandatory cleanup"
    fi
  fi
fi

if [[ -d "$ROOT/.github/workflows" ]]; then
  if ! rg -q 'v\*\.\*\.\*|tags:' "$ROOT/.github/workflows"; then
    gap "GHA has no v* tag publish (GitHub Release mirror)"
  fi
  if rg -q 'gateway-desktop' "$ROOT/.github/workflows"; then
    if ! rg -q 'publish-r2.sh gateway-desktop' "$ROOT/.github/workflows"; then
      gap "GHA mentions gateway-desktop but does not call publish-r2.sh gateway-desktop"
    fi
    say "GHA is the documented R2 writer for gateway-desktop (TeamCity exception)"
  fi
fi

say "public URL shape: /release/{application}/{platform}/{arch}/{version|latest}"
say "R2 keys match that path. TeamCity writes gateway; GHA writes gateway-desktop."
exit "$fail"
