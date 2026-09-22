#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"
HOME_DIR="$(resolve_home)"
load_env "$HOME_DIR"
URL="$(listen_url)/healthz"
bdgw_need_cmd curl || bdgw_die "curl required for health check"
curl -fsS --max-time 5 "$URL"
echo
