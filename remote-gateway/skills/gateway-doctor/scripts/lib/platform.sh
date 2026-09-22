#!/usr/bin/env bash
# Portable platform helpers for setup plugin skills.
# Targets: Linux, macOS (Darwin), Windows (Git Bash / MSYS / Cygwin / WSL).
# shellcheck shell=bash

bdgw_need_cmd() { command -v "$1" >/dev/null 2>&1; }

bdgw_die() { echo "error: $*" >&2; exit 1; }
bdgw_warn() { echo "warning: $*" >&2; }
bdgw_info() { echo "$*"; }

# Normalize OS → linux | darwin | windows
bdgw_detect_os() {
  local uname_s
  uname_s="$(uname -s 2>/dev/null || echo unknown)"
  case "$uname_s" in
    Linux|linux)
      # WSL still reports Linux; treat as linux (systemd optional)
      echo linux
      ;;
    Darwin|darwin) echo darwin ;;
    MINGW*|MSYS*|CYGWIN*|mingw*|msys*|cygwin*) echo windows ;;
    *)
      case "${OSTYPE:-}" in
        msys*|cygwin*|win*) echo windows ;;
        darwin*) echo darwin ;;
        linux*) echo linux ;;
        *) bdgw_die "unsupported OS: uname=$uname_s OSTYPE=${OSTYPE:-unset} (need linux|darwin|windows)" ;;
      esac
      ;;
  esac
}

# Normalize arch → amd64 | arm64
bdgw_detect_arch() {
  local m
  m="$(uname -m 2>/dev/null || echo unknown)"
  case "$m" in
    x86_64|amd64|AMD64) echo amd64 ;;
    aarch64|arm64|ARM64) echo arm64 ;;
    *) bdgw_die "unsupported architecture: $m (need amd64 or arm64)" ;;
  esac
}

# Binary name for downloads
bdgw_artifact_name() {
  local product="$1" # gateway | vault
  local os arch ext=""
  os="$(bdgw_detect_os)"
  arch="$(bdgw_detect_arch)"
  [[ "$os" == "windows" ]] && ext=".exe"
  echo "bytedesk-${product}-${os}-${arch}${ext}"
}

# Portable install of a file with mode (no GNU install required)
bdgw_install_bin() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  cp -f "$src" "$dest"
  chmod 755 "$dest" 2>/dev/null || chmod u+x "$dest" || true
}

# User home that works under Git Bash (USERPROFILE) and Unix
bdgw_home() {
  if [[ -n "${HOME:-}" && -d "${HOME}" ]]; then
    echo "$HOME"
  elif [[ -n "${USERPROFILE:-}" ]]; then
    if bdgw_need_cmd cygpath; then
      cygpath -u "$USERPROFILE"
    else
      echo "$USERPROFILE" | sed -e "s#\\\\#/#g" -e "s#^\([A-Za-z]\):#/\L\1#"
    fi
  else
    echo "${HOME:-/tmp}"
  fi
}

# Default product homes
bdgw_gateway_home_default() {
  local h
  h="${BYTEDESK_GATEWAY_HOME:-${GATEWAY_HOME:-}}"
  if [[ -n "$h" ]]; then
    echo "$h"
    return 0
  fi
  h="$(bdgw_home)/.bytedesk-gateway"
  if [[ -d "$h" ]]; then
    echo "$h"
    return 0
  fi
  # Legacy monorepo product home
  if [[ -d "$(bdgw_home)/.bytedesk-emote-gateway" ]]; then
    echo "$(bdgw_home)/.bytedesk-emote-gateway"
    return 0
  fi
  echo "$(bdgw_home)/.bytedesk-gateway"
}

bdgw_vault_home_default() {
  echo "${BYTEDESK_VAULT_HOME:-${VAULT_HOME:-$(bdgw_home)/.bytedesk-vault}}"
}

# Service backend: systemd | launchd | none
bdgw_service_backend() {
  local os
  os="$(bdgw_detect_os)"
  case "$os" in
    linux)
      if bdgw_need_cmd systemctl && systemctl --user show-environment >/dev/null 2>&1; then
        echo systemd
      else
        echo none
      fi
      ;;
    darwin)
      if bdgw_need_cmd launchctl; then
        echo launchd
      else
        echo none
      fi
      ;;
    windows)
      echo none # use run.sh / run.ps1 / Start-Process
      ;;
    *) echo none ;;
  esac
}

# Random hex (portable)
bdgw_rand_hex() {
  local n="${1:-24}"
  if bdgw_need_cmd openssl; then
    openssl rand -hex "$n" 2>/dev/null && return 0
  fi
  if [[ -r /dev/urandom ]]; then
    head -c "$n" /dev/urandom 2>/dev/null | od -An -tx1 | tr -d " \n" | head -c "$((n*2))"
    echo
    return 0
  fi
  bdgw_warn "weak random: no openssl or /dev/urandom"
  printf "%s" "$(date +%s%N 2>/dev/null || date +%s)$$" | cksum | awk "{print \$1}"
}

bdgw_rand_b64() {
  local n="${1:-48}"
  if bdgw_need_cmd openssl; then
    openssl rand -base64 "$n" 2>/dev/null && return 0
  fi
  bdgw_rand_hex "$n"
}

# Resolve skill root from a script path (…/skills/<name>/scripts/foo.sh → skill dir)
bdgw_skill_dir_from_script() {
  local script="$1"
  local d
  d="$(cd "$(dirname "$script")" && pwd)"
  cd "$d/.." && pwd
}

# Walk up from a path looking for monorepo markers (src/main.go or go.mod + src/)
bdgw_find_repo_root() {
  local start="${1:-.}"
  local d
  d="$(cd "$start" && pwd)"
  while [[ "$d" != "/" ]]; do
    if [[ -f "$d/src/main.go" ]] || [[ -f "$d/go.mod" && -d "$d/src" ]]; then
      echo "$d"
      return 0
    fi
    d="$(dirname "$d")"
  done
  return 1
}

# Portable file size in bytes
bdgw_stat_size() {
  local f="$1"
  if stat -c%s "$f" >/dev/null 2>&1; then
    stat -c%s "$f"
  elif stat -f%z "$f" >/dev/null 2>&1; then
    stat -f%z "$f"
  else
    wc -c <"$f" | tr -d ' '
  fi
}

# Portable sha256 of a file (hex only)
bdgw_sha256() {
  local f="$1"
  if bdgw_need_cmd sha256sum; then
    sha256sum "$f" | awk '{print $1}'
  elif bdgw_need_cmd shasum; then
    shasum -a 256 "$f" | awk '{print $1}'
  elif bdgw_need_cmd openssl; then
    openssl dgst -sha256 "$f" | awk '{print $NF}'
  else
    bdgw_warn "no sha256 tool"
    echo "unknown"
  fi
}

# Portable temp dir (Windows Git Bash has TMPDIR / TEMP / TMP)
bdgw_tmpdir() {
  local t="${TMPDIR:-${TEMP:-${TMP:-/tmp}}}"
  # Normalize backslashes for Git Bash
  t="${t//\\//}"
  mkdir -p "$t" 2>/dev/null || true
  echo "$t"
}

# Write a temp file path with prefix
bdgw_mktemp() {
  local prefix="${1:-bdgw}"
  local t
  t="$(bdgw_tmpdir)"
  if bdgw_need_cmd mktemp; then
    mktemp "${t}/${prefix}.XXXXXX" 2>/dev/null && return 0
  fi
  local f="${t}/${prefix}.$$.$RANDOM"
  : >"$f"
  echo "$f"
}

# Live gateway binary path candidates under a product home
bdgw_resolve_gateway_bin() {
  local home="$1"
  local os cand
  os="$(bdgw_detect_os)"
  for cand in \
    "$home/bin/bytedesk-gateway.exe" \
    "$home/bin/bytedesk-gateway" \
    "$home/bytedesk-gateway.exe" \
    "$home/bytedesk-gateway" \
    "$home/bytedesk-emote-gateway.exe" \
    "$home/bytedesk-emote-gateway"; do
    if [[ -f "$cand" ]]; then
      echo "$cand"
      return 0
    fi
  done
  # Preferred install location when nothing exists yet
  if [[ "$os" == "windows" ]]; then
    echo "$home/bin/bytedesk-gateway.exe"
  else
    echo "$home/bin/bytedesk-gateway"
  fi
}

# First host from LISTEN_HOST (may be comma-separated)
bdgw_first_host() {
  local h="${1:-127.0.0.1}"
  h="${h%%,*}"
  h="${h// /}"
  echo "${h:-127.0.0.1}"
}

# ISO-ish timestamp (portable; no GNU date -Is required)
bdgw_ts() {
  date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u
}

# Restart / stop / status abstraction for gateway service
# Args: action=start|stop|status|restart  home_dir  [plist_label]
bdgw_service_ctl() {
  local action="$1" home="${2:-}" label="${3:-ai.bytedesk.gateway}"
  local backend pidfile run_sh run_ps1 pid
  backend="$(bdgw_service_backend)"
  pidfile="${home}/gateway.pid"
  run_sh="${home}/run.sh"
  run_ps1="${home}/run.ps1"

  case "$backend" in
    systemd)
      case "$action" in
        start) systemctl --user start bytedesk-gateway.service 2>/dev/null || systemctl --user start bytedesk-emote-gateway.service ;;
        stop) systemctl --user stop bytedesk-gateway.service 2>/dev/null || systemctl --user stop bytedesk-emote-gateway.service || true ;;
        restart)
          systemctl --user restart bytedesk-gateway.service 2>/dev/null \
            || systemctl --user restart bytedesk-emote-gateway.service
          ;;
        status)
          systemctl --user --no-pager status bytedesk-gateway.service 2>/dev/null \
            || systemctl --user --no-pager status bytedesk-emote-gateway.service 2>/dev/null \
            || echo "unit=missing"
          ;;
      esac
      ;;
    launchd)
      local plist="${HOME}/Library/LaunchAgents/${label}.plist"
      case "$action" in
        start|restart)
          [[ -f "$plist" ]] || bdgw_die "missing $plist (re-run gateway-install)"
          launchctl unload "$plist" 2>/dev/null || true
          launchctl load "$plist"
          ;;
        stop) launchctl unload "$plist" 2>/dev/null || true ;;
        status) launchctl list 2>/dev/null | grep -i bytedesk || echo "launchd: $label" ;;
      esac
      ;;
    *)
      case "$action" in
        stop)
          if [[ -f "$pidfile" ]]; then
            pid="$(cat "$pidfile" 2>/dev/null || true)"
            if [[ "$pid" =~ ^[0-9]+$ ]]; then
              kill "$pid" 2>/dev/null || true
            fi
            rm -f "$pidfile"
          fi
          ;;
        start|restart)
          if [[ "$action" == "restart" ]]; then
            bdgw_service_ctl stop "$home" "$label" || true
            sleep 0.5
          fi
          local os
          os="$(bdgw_detect_os)"
          if [[ "$os" == "windows" && -f "$run_ps1" ]]; then
            if bdgw_need_cmd pwsh; then
              nohup pwsh -NoProfile -File "$run_ps1" >"${home}/gateway.log" 2>&1 &
            elif bdgw_need_cmd powershell.exe; then
              nohup powershell.exe -NoProfile -File "$run_ps1" >"${home}/gateway.log" 2>&1 &
            elif [[ -f "$run_sh" ]]; then
              nohup bash "$run_sh" >"${home}/gateway.log" 2>&1 &
            else
              bdgw_die "no run.ps1/run.sh in $home"
            fi
          else
            [[ -f "$run_sh" ]] || bdgw_die "missing $run_sh"
            chmod +x "$run_sh" 2>/dev/null || true
            nohup bash "$run_sh" >"${home}/gateway.log" 2>&1 &
          fi
          echo $! >"$pidfile"
          bdgw_info "pid=$(cat "$pidfile") log=${home}/gateway.log"
          ;;
        status)
          if [[ -f "$pidfile" ]]; then
            pid="$(cat "$pidfile")"
            if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
              echo "pid=$pid running"
            else
              echo "pid=stale-or-dead ($pid)"
            fi
          else
            echo "pid=none backend=none"
          fi
          ;;
      esac
      ;;
  esac
}

# Is the managed gateway "active"? returns 0 if yes
bdgw_service_is_active() {
  local home="${1:-}" label="${2:-ai.bytedesk.gateway}"
  local backend st pid
  backend="$(bdgw_service_backend)"
  case "$backend" in
    systemd)
      st="$(systemctl --user is-active bytedesk-gateway.service 2>/dev/null || true)"
      [[ "$st" == "active" ]] && return 0
      st="$(systemctl --user is-active bytedesk-emote-gateway.service 2>/dev/null || true)"
      [[ "$st" == "active" ]]
      ;;
    launchd)
      launchctl list 2>/dev/null | grep -qi bytedesk
      ;;
    *)
      if [[ -f "${home}/gateway.pid" ]]; then
        pid="$(cat "${home}/gateway.pid")"
        [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
      else
        return 1
      fi
      ;;
  esac
}
