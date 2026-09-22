#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"
HOME_DIR="$(resolve_home)"
load_env "$HOME_DIR"
echo "os=$(bdgw_detect_os) arch=$(bdgw_detect_arch) backend=$(bdgw_service_backend)"
echo "home=$HOME_DIR"
echo "bin=$(bin_path "$HOME_DIR")"
echo "bind=$(listen_url)"
bdgw_service_ctl status "$HOME_DIR"
