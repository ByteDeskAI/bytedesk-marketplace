#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/platform.sh"
OS="$(bdgw_detect_os)"
echo "os=$OS profile check: desktop"
case "$OS" in
  linux)
    for c in ttyd tmux firefox Xvfb x11vnc websockify; do
      if bdgw_need_cmd "$c"; then echo "ok $c"; else echo "MISSING $c"; fi
    done
    echo "hint: package manager install ttyd tmux firefox xvfb x11vnc websockify"
    ;;
  darwin)
    for c in ttyd tmux firefox; do
      if bdgw_need_cmd "$c"; then echo "ok $c"; else echo "MISSING $c"; fi
    done
    echo "hint: brew install ttyd tmux"
    echo "virtual desktop on macOS is best-effort; prefer core profile for gateway API"
    ;;
  windows)
    for c in ttyd tmux; do
      if bdgw_need_cmd "$c"; then echo "ok $c"; else echo "MISSING $c"; fi
    done
    echo "hint: scoop/choco or WSL for ttyd/tmux; use RDP instead of VNC stack"
    ;;
esac
