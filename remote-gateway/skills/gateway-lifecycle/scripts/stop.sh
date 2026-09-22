#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"
HOME_DIR="$(resolve_home)"
bdgw_service_ctl stop "$HOME_DIR"
bdgw_info "stop requested for $HOME_DIR"
