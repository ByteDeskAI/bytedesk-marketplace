#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/platform.sh"
URL="${PUBLIC_PROBE_URL:-${1:-}}"
if [[ -z "$URL" ]]; then
  echo "usage: probe-public.sh <https://host/healthz>"
  echo "or set PUBLIC_PROBE_URL"
  echo "Private-first installs have no public URL until Funnel/tunnel is configured."
  exit 2
fi
bdgw_need_cmd curl || bdgw_die "curl required"
curl -fsS --max-time 10 "$URL"
echo
