#!/usr/bin/env bash
# Shared helpers for gateway-lifecycle (sourced by sibling scripts).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/platform.sh"

resolve_home() {
  bdgw_gateway_home_default
}

bin_path() {
  bdgw_resolve_gateway_bin "$1"
}

load_env() {
  local home="$1"
  if [[ -f "$home/control.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$home/control.env"
    set +a
  fi
}

listen_url() {
  local host port
  host="$(bdgw_first_host "${LISTEN_HOST:-127.0.0.1}")"
  port="${LISTEN_PORT:-18443}"
  echo "http://${host}:${port}"
}
