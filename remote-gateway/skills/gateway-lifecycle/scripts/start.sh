#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"
HOME_DIR="$(resolve_home)"
[[ -d "$HOME_DIR" ]] || bdgw_die "gateway home not found: $HOME_DIR (run gateway-install first)"
load_env "$HOME_DIR"
bdgw_info "os=$(bdgw_detect_os) arch=$(bdgw_detect_arch) backend=$(bdgw_service_backend)"
bdgw_service_ctl start "$HOME_DIR"
bdgw_info "health: $(listen_url)/healthz"
