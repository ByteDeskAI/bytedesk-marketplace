#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"
HOME_DIR="$(resolve_home)"
load_env "$HOME_DIR"
: "${SETUP_TOKEN:?SETUP_TOKEN missing from control.env}"
echo "$(listen_url)/setup?token=${SETUP_TOKEN}"
