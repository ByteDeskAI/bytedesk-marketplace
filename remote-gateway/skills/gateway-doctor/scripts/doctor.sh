#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/platform.sh"

HOME_DIR="${BYTEDESK_GATEWAY_HOME:-${GATEWAY_HOME:-$(bdgw_gateway_home_default)}}"
if [[ ! -d "$HOME_DIR" && -d "${HOME}/.bytedesk-emote-gateway" ]]; then
  HOME_DIR="${HOME}/.bytedesk-emote-gateway"
fi

echo "=== ByteDesk gateway doctor ==="
echo "os=$(bdgw_detect_os) arch=$(bdgw_detect_arch) backend=$(bdgw_service_backend)"
echo "home=$HOME_DIR"
echo "home_exists=$([[ -d "$HOME_DIR" ]] && echo yes || echo NO)"
echo "bin=$(bdgw_resolve_gateway_bin "$HOME_DIR")"

for f in control.env bin/bytedesk-gateway bin/bytedesk-gateway.exe run.sh run.ps1 config.json; do
  if [[ -e "$HOME_DIR/$f" ]]; then
    echo "present: $f"
  fi
done

if [[ -f "$HOME_DIR/control.env" ]]; then
  for k in SESSION_SECRET SETUP_TOKEN ADMIN_TOKEN LISTEN_HOST LISTEN_PORT; do
    if grep -q "^${k}=" "$HOME_DIR/control.env" 2>/dev/null; then
      echo "control.env has $k"
    else
      echo "control.env missing $k"
    fi
  done
  # Read only validated listen coordinates; never execute control.env or print
  # credentials/health response bodies as part of diagnostics.
  _h="$(sed -n 's/^LISTEN_HOST=//p' "$HOME_DIR/control.env" | tail -n 1)"
  _p="$(sed -n 's/^LISTEN_PORT=//p' "$HOME_DIR/control.env" | tail -n 1)"
  _h="${_h%\"}"; _h="${_h#\"}"; _h="${_h%\'}"; _h="${_h#\'}"
  _p="${_p%\"}"; _p="${_p#\"}"; _p="${_p%\'}"; _p="${_p#\'}"
  [[ "$_h" =~ ^[a-zA-Z0-9_.:,\[\]-]+$ ]] || _h=127.0.0.1
  [[ "$_p" =~ ^[0-9]{1,5}$ ]] && [[ "$_p" -gt 0 && "$_p" -le 65535 ]] || _p=18443
  _h="$(bdgw_first_host "$_h")"
  URL="http://${_h}:${_p}/healthz"
  echo "health_url=$URL"
  if bdgw_need_cmd curl; then
    if curl -fsS --max-time 3 -o /dev/null "$URL" 2>/dev/null; then
      echo "healthz=REACHABLE"
    else
      echo "healthz=UNREACHABLE"
    fi
  fi
else
  echo "control.env: missing"
fi

for c in curl openssl ttyd tmux rclone; do
  if bdgw_need_cmd "$c"; then echo "dep ok: $c"; else echo "dep missing: $c"; fi
done
if bdgw_need_cmd python3; then
  python3 "$SCRIPT_DIR/containment.py" doctor "$HOME_DIR" || true
else
  echo "containment_prerequisite=python3-unavailable"
  echo "containment_activation=unverified"
fi
echo "=== end doctor (no secrets printed) ==="
