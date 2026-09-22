#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/platform.sh"
OS="$(bdgw_detect_os)"
case "$OS" in
  linux)
    if [[ -f /etc/pam.d/bytedesk-emote-gateway ]]; then
      echo "present: /etc/pam.d/bytedesk-emote-gateway"
    else
      echo "missing dedicated PAM service file"
      echo "On a monorepo checkout: ./cli setup-pam"
      echo "Or create /etc/pam.d/bytedesk-emote-gateway from distro login stack (requires sudo)."
    fi
    HOME_DIR="${BYTEDESK_GATEWAY_HOME:-${GATEWAY_HOME:-$(bdgw_gateway_home_default)}}"
    if [[ -f "$HOME_DIR/control.env" ]]; then
      if grep -q '^AUTH_MODE=pam' "$HOME_DIR/control.env" 2>/dev/null; then
        echo "AUTH_MODE=pam already set"
      else
        echo "To enable PAM, add AUTH_MODE=pam and PAM_SERVICE=bytedesk-emote-gateway (or login) to $HOME_DIR/control.env"
      fi
    fi
    ;;
  darwin)
    echo "PAM on macOS is limited for non-root services. Prefer AUTH_MODE=local with TOTP after /setup."
    ;;
  windows)
    echo "PAM is not available on Windows. Use AUTH_MODE=local with TOTP after /setup (or Vault)."
    ;;
esac
