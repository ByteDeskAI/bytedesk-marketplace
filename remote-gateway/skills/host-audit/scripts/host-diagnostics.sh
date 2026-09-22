#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/platform.sh"
OS="$(bdgw_detect_os)"
MODE="${1:-inventory}"

echo "=== host-diagnostics mode=$MODE os=$OS ==="
echo "date=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u)"
echo "user=${USER:-${USERNAME:-unknown}} home=${HOME:-}"
echo "shell=${SHELL:-} arch=$(bdgw_detect_arch)"

case "$MODE" in
  inventory|audit)
    for h in "${BYTEDESK_GATEWAY_HOME:-}" "${GATEWAY_HOME:-}" "$HOME/.bytedesk-gateway" "$HOME/.bytedesk-emote-gateway" "$HOME/.bytedesk-vault"; do
      [[ -z "$h" ]] && continue
      [[ -d "$h" ]] && echo "dir present: $h"
    done
    if bdgw_need_cmd ss; then ss -ltn 2>/dev/null | head -40 || true
    elif bdgw_need_cmd netstat; then netstat -an 2>/dev/null | head -40 || true
    fi
    case "$OS" in
      linux) systemctl --user list-units 'bytedesk*' --no-pager 2>/dev/null || true ;;
      darwin) launchctl list 2>/dev/null | grep -i bytedesk || true ;;
      windows)
        if bdgw_need_cmd tasklist; then
          tasklist 2>/dev/null | grep -i bytedesk || echo "no bytedesk process in tasklist"
        else
          echo "windows: run host-diagnostics.ps1 for process list"
        fi
        ;;
    esac
    ;;
  eagain)
    echo "EAGAIN / task exhaustion (Linux cgroup-focused; best-effort elsewhere)"
    if [[ -r /sys/fs/cgroup/pids.current ]]; then
      echo "pids.current=$(cat /sys/fs/cgroup/pids.current 2>/dev/null || true)"
      echo "pids.max=$(cat /sys/fs/cgroup/pids.max 2>/dev/null || true)"
    fi
    if bdgw_need_cmd systemctl; then
      systemctl show "user@$(id -u)" -p TasksMax 2>/dev/null || true
    fi
    echo "ulimit -u=$(ulimit -u 2>/dev/null || true)"
    ;;
  *)
    echo "usage: host-diagnostics.sh [inventory|eagain]"
    exit 2
    ;;
esac
echo "=== end host-diagnostics ==="
