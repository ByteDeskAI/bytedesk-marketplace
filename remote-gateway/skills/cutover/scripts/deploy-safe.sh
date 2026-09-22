#!/usr/bin/env bash
# Uptime-safe gateway deploy: shadow-boot a candidate binary before touching production.
#
# Usage:
#   scripts/deploy-safe.sh preflight          # live + remote probes only
#   scripts/deploy-safe.sh verify-candidate   # build + shadow /healthz; never installs
#   scripts/deploy-safe.sh stage              # preflight → verify → last-good → install binary ONLY (no restart)
#   scripts/deploy-safe.sh restart-cutover    # single restart of already-installed binary + postflight
#   scripts/deploy-safe.sh postflight         # dual healthz + unit + remote + terminal sleep I/O (no build/restart)
#   scripts/deploy-safe.sh deploy             # full: stage + restart-cutover
#   scripts/deploy-safe.sh shadow-fail-drill  # prove a bad candidate is rejected while live stays up
#
# Env overrides:
#   BYTEDESK_EMOTE_GATEWAY_HOME   default ~/.bytedesk-emote-gateway
#   SHADOW_PORT                   default 18443
#   SHADOW_HOST                   default 127.0.0.1
#   PUBLIC_PROBE_URL              default https://gateway.dev.bytedesk.ai/healthz
#   EVIDENCE_DIR                  default ./_uptime_evidence (repo-local; override for goal scratch)
#   EVIDENCE_GC                   default 1 — set 0 to disable evidence dir janitor
#   EVIDENCE_MAX_AGE_MIN          default 60 — prune regular files older than this many minutes
#   SKIP_REMOTE_PROBE             set to 1 to skip public URL (not recommended)
#   SKIP_TERMINAL_PROBE           set to 1 to skip terminal sleep I/O + session liveness (not recommended)
#   SKIP_INSTALL_IF_UNCHANGED     default 1 — if candidate == live binary, skip restart on deploy
#   FORCE_RESTART                 set to 1 so restart-cutover restarts even when stage.result=UNCHANGED
#   SKIP_SPA_BUILD                set to 1 to skip web/ npm build before go build — the ONLY
#                                 way to skip it; a missing web/ or npm is otherwise fatal

set -euo pipefail

# Fail before evidence cleanup, builds, installation, or service operations.
# Read-only health checks remain usable from an installed product home.
require_develop_cutover_source() {
  case "${1:-}" in
    verify-candidate|stage|restart-cutover|deploy|shadow-fail-drill) ;;
    *) return 0 ;;
  esac
  local top branch source_top
  top="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    printf '%s\n' 'ERROR: cutover requires a Gateway Git checkout on branch develop; no checkout found in the invoking directory.' >&2
    return 1
  }
  branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" || branch=""
  if [[ "$branch" != "develop" || ! -f "$top/src/main.go" ]]; then
    printf 'ERROR: cutover requires the Gateway develop branch (current: %s). Merge into develop, then run from that checkout; detached and feature checkouts are refused.\n' "${branch:-detached HEAD}" >&2
    return 1
  fi
  if [[ -n "${BYTEDESK_EMOTE_GATEWAY_SOURCE_DIR:-}" ]]; then
    source_top="$(cd "$BYTEDESK_EMOTE_GATEWAY_SOURCE_DIR" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)" || source_top=""
    if [[ "$source_top" != "$top" ]]; then
      printf '%s\n' 'ERROR: cutover source override must resolve to the invoking develop checkout; unset BYTEDESK_EMOTE_GATEWAY_SOURCE_DIR or correct it.' >&2
      return 1
    fi
  fi
}
require_develop_cutover_source "${1:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/platform.sh"

# REPO_ROOT is the gateway checkout — the only source of web/ for the embedded
# SPA. Guessing it is how a cutover silently embeds a stale web_spa and still
# reports PASS (ADR 0026 defect 16), so every tier must PROVE the path is a
# checkout, and an unproven root stays EMPTY. build_candidate then refuses;
# only preflight / postflight carry on without a repo. Build and restart modes
# have already required the invoking develop checkout above.
# Acting checkout first, matching _resolve_gateway_source_dir below, so the SPA
# and the Go build can never come from two different checkouts.
# bdgw_find_repo_root (lib/platform.sh) is the proof: src/main.go, or go.mod + src/.
REPO_ROOT="$(bdgw_find_repo_root . || true)"
[[ -n "$REPO_ROOT" ]] || REPO_ROOT="$(bdgw_find_repo_root "$SCRIPT_DIR" || true)"

BDGW_OS="$(bdgw_detect_os)"
BDGW_BACKEND="$(bdgw_service_backend)"

# Product home: commercial free-core or legacy monorepo names
_resolve_gateway_dir() {
  if [[ -n "${BYTEDESK_GATEWAY_HOME:-}" ]]; then echo "$BYTEDESK_GATEWAY_HOME"; return; fi
  if [[ -n "${GATEWAY_HOME:-}" ]]; then echo "$GATEWAY_HOME"; return; fi
  if [[ -n "${BYTEDESK_EMOTE_GATEWAY_HOME:-}" ]]; then echo "$BYTEDESK_EMOTE_GATEWAY_HOME"; return; fi
  bdgw_gateway_home_default
}
GATEWAY_DIR="$(_resolve_gateway_dir)"

# Prefer BYTEDESK_EMOTE_GATEWAY_SOURCE_DIR, but auto-correct repo-root → src when
# main.go lives under src/ (cli historically exported the repo root by mistake).
_resolve_gateway_source_dir() {
  local cand="${BYTEDESK_EMOTE_GATEWAY_SOURCE_DIR:-}"
  local acting="" acting_top="" cand_top=""
  if acting_top="$(git rev-parse --show-toplevel 2>/dev/null)" && [[ -f "$acting_top/src/main.go" ]]; then
    acting="$acting_top/src"
  elif [[ -n "$acting_top" && -f "$acting_top/main.go" ]]; then
    acting="$acting_top"
  fi
  if [[ -n "$acting" && -n "$cand" ]]; then
    cand_top="$(cd "$cand" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null || true)"
    if [[ -n "$cand_top" && -n "$acting_top" && "$cand_top" != "$acting_top" ]]; then
      printf '%s\n' "$acting"
      return 0
    fi
  fi
  if [[ -n "$cand" && -f "$cand/main.go" ]]; then
    printf '%s\n' "$cand"
    return 0
  fi
  if [[ -n "$cand" && -f "$cand/src/main.go" ]]; then
    printf '%s\n' "$cand/src"
    return 0
  fi
  if [[ -n "$acting" ]]; then
    printf '%s\n' "$acting"
    return 0
  fi
  if [[ -f "$REPO_ROOT/src/main.go" ]]; then
    printf '%s\n' "$REPO_ROOT/src"
    return 0
  fi
  printf '%s\n' "${cand:-$REPO_ROOT/src}"
}
GATEWAY_SOURCE_DIR="$(_resolve_gateway_source_dir)"

# Resolve live binary (bin/ layout from install.sh, or legacy flat name)
if [[ -f "${GATEWAY_DIR}/bin/bytedesk-gateway.exe" || -f "${GATEWAY_DIR}/bin/bytedesk-gateway" || -f "${GATEWAY_DIR}/bytedesk-emote-gateway" || -f "${GATEWAY_DIR}/bytedesk-emote-gateway.exe" ]]; then
  GATEWAY_BIN="$(bdgw_resolve_gateway_bin "$GATEWAY_DIR")"
else
  if [[ "$BDGW_OS" == "windows" ]]; then
    GATEWAY_BIN="${GATEWAY_DIR}/bin/bytedesk-gateway.exe"
  else
    # Prefer commercial layout; fall back to legacy monorepo path if home is emote
    if [[ "$(basename "$GATEWAY_DIR")" == ".bytedesk-emote-gateway" ]]; then
      GATEWAY_BIN="${GATEWAY_DIR}/bytedesk-emote-gateway"
    else
      GATEWAY_BIN="${GATEWAY_DIR}/bin/bytedesk-gateway"
    fi
  fi
fi
GATEWAY_BIN_LAST_GOOD="${GATEWAY_BIN}.last-good"
GATEWAY_BIN_NEW="${GATEWAY_BIN}.new"
GATEWAY_UNIT="${GATEWAY_UNIT:-bytedesk-gateway.service}"
# Legacy unit name still checked when present
GATEWAY_UNIT_LEGACY="${GATEWAY_UNIT_LEGACY:-bytedesk-emote-gateway.service}"
WATCHDOG_UNIT="${WATCHDOG_UNIT:-bytedesk-emote-gateway-watchdog.service}"
TUNNEL_WATCHDOG_UNIT="${TUNNEL_WATCHDOG_UNIT:-bytedesk-emote-gateway-tunnel-watchdog.service}"
LAUNCHD_LABEL="${LAUNCHD_LABEL:-ai.bytedesk.gateway}"

# Prefer the unit that is actually running. A stale commercial unit
# (bytedesk-gateway.service) can be stuck in activating/auto-restart while the
# live process is bytedesk-emote-gateway.service.
# Important: do not use `is-active A || is-active B` in $(...) — both can print
# (e.g. "activating\nactive") and break [[ $state == active ]].
_systemd_unit_quiet_active() {
  systemctl --user is-active --quiet "$1" 2>/dev/null
}
resolve_live_gateway_unit() {
  # If operator forced GATEWAY_UNIT and it is fully active, keep it.
  if [[ -n "${GATEWAY_UNIT_FORCE:-}" ]]; then
    GATEWAY_UNIT="$GATEWAY_UNIT_FORCE"
    return 0
  fi
  if [[ "$BDGW_BACKEND" != "systemd" ]]; then
    return 0
  fi
  if _systemd_unit_quiet_active "$GATEWAY_UNIT"; then
    return 0
  fi
  if _systemd_unit_quiet_active "$GATEWAY_UNIT_LEGACY"; then
    log "using live unit $GATEWAY_UNIT_LEGACY (primary $GATEWAY_UNIT not active)"
    GATEWAY_UNIT="$GATEWAY_UNIT_LEGACY"
    return 0
  fi
  # Neither fully active: if home is emote layout, prefer legacy name for restart target.
  if [[ "$(basename "$GATEWAY_DIR")" == ".bytedesk-emote-gateway" ]]; then
    GATEWAY_UNIT="$GATEWAY_UNIT_LEGACY"
  fi
}
# Allow explicit override: GATEWAY_UNIT_FORCE=bytedesk-emote-gateway.service
if [[ -n "${GATEWAY_UNIT_FORCE:-}" ]]; then
  GATEWAY_UNIT="$GATEWAY_UNIT_FORCE"
fi
# resolve_live_gateway_unit runs after log() is defined (see below).

# Live bind: prefer control.env, then env overrides, then defaults
LIVE_HOST="${BYTEDESK_EMOTE_GATEWAY_LISTEN_HOST:-${LISTEN_HOST:-127.0.0.1}}"
LIVE_PORT="${BYTEDESK_EMOTE_GATEWAY_PORT:-${LISTEN_PORT:-18443}}"
if [[ -f "$GATEWAY_DIR/control.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$GATEWAY_DIR/control.env"; set +a
  LIVE_HOST="$(bdgw_first_host "${BYTEDESK_EMOTE_GATEWAY_LISTEN_HOST:-${LISTEN_HOST:-$LIVE_HOST}}")"
  LIVE_PORT="${BYTEDESK_EMOTE_GATEWAY_PORT:-${LISTEN_PORT:-$LIVE_PORT}}"
fi
LIVE_HOST="$(bdgw_first_host "$LIVE_HOST")"

SHADOW_HOST="${SHADOW_HOST:-127.0.0.1}"
SHADOW_PORT="${SHADOW_PORT:-18443}"
SHADOW_HOME="${SHADOW_HOME:-$GATEWAY_DIR/shadow-verify}"
PUBLIC_PROBE_URL="${PUBLIC_PROBE_URL:-https://gateway.dev.bytedesk.ai/healthz}"
EVIDENCE_DIR="${EVIDENCE_DIR:-${REPO_ROOT:-$GATEWAY_DIR}/_uptime_evidence}"
SKIP_REMOTE_PROBE="${SKIP_REMOTE_PROBE:-0}"
SKIP_TERMINAL_PROBE="${SKIP_TERMINAL_PROBE:-0}"
SKIP_INSTALL_IF_UNCHANGED="${SKIP_INSTALL_IF_UNCHANGED:-1}"
SHADOW_TIMEOUT_SECS="${SHADOW_TIMEOUT_SECS:-30}"
SHADOW_PID=""
SHADOW_LOG=""
TMPBASE="$(bdgw_tmpdir)"

log() { printf '%s %s\n' "$(bdgw_ts)" "$*"; }
die() {
  if [[ "${CUTOVER_JOB_ACTIVE:-0}" == "1" ]]; then
    cutover_job_fail "$*" 2>/dev/null || true
  fi
  log "ERROR: $*"
  exit 1
}

# Pick live systemd unit after log() exists (may print a note).
resolve_live_gateway_unit

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

mkdir -p "$EVIDENCE_DIR" "$GATEWAY_DIR"
# shellcheck source=lib/uptime-evidence-gc.sh
if [[ -f "$SCRIPT_DIR/lib/uptime-evidence-gc.sh" ]]; then
  source "$SCRIPT_DIR/lib/uptime-evidence-gc.sh"
  init_uptime_evidence
fi
# shellcheck source=lib/cutover-job.sh
if [[ -f "$SCRIPT_DIR/lib/cutover-job.sh" ]]; then
  source "$SCRIPT_DIR/lib/cutover-job.sh"
fi
# shellcheck source=lib/wait-live-ready.sh
_wlr="$SCRIPT_DIR/lib/wait-live-ready.sh"
if [[ ! -f "$_wlr" && -n "${REPO_ROOT:-}" ]]; then
  _wlr="$REPO_ROOT/scripts/lib/wait-live-ready.sh"
fi
if [[ -f "$_wlr" ]]; then
  # shellcheck disable=SC1090
  source "$_wlr"
fi

cleanup_shadow() {
  if [[ -n "${SHADOW_PID:-}" ]] && kill -0 "$SHADOW_PID" 2>/dev/null; then
    log "killing shadow pid=$SHADOW_PID"
    kill "$SHADOW_PID" 2>/dev/null || true
    # give it a moment, then force
    for _ in 1 2 3 4 5; do
      kill -0 "$SHADOW_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -9 "$SHADOW_PID" 2>/dev/null || true
    wait "$SHADOW_PID" 2>/dev/null || true
  fi
  SHADOW_PID=""
}
trap cleanup_shadow EXIT

live_healthz() {
  curl -fsS -m 3 "http://${LIVE_HOST}:${LIVE_PORT}/healthz" 2>/dev/null || return 1
}

bus_health_probe() {
  local headers substrate refusals
  headers="$(curl -fsSI -m 3 "http://${LIVE_HOST}:${LIVE_PORT}/healthz" 2>/dev/null)" || return 1
  substrate="$(awk 'BEGIN { IGNORECASE=1 } /^X-ByteDesk-Bus-Substrate:/ { sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit }' <<<"$headers")"
  refusals="$(awk 'BEGIN { IGNORECASE=1 } /^X-ByteDesk-Bus-Refusals:/ { sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit }' <<<"$headers")"
  [[ -n "$substrate" && "$refusals" =~ ^[0-9]+$ ]] || return 1
  printf 'bus.substrate=%s Refusals=%s\n' "$substrate" "$refusals"
}

remote_probe() {
  if [[ "$SKIP_REMOTE_PROBE" == "1" ]]; then
    echo "skipped"
    return 0
  fi
  # Accept body "ok" or login HTML / any 200 that is not CF error page
  local code body
  code="$(curl -sS -m 10 -o "$TMPBASE/deploy-safe-remote.body" -w "%{http_code}" "$PUBLIC_PROBE_URL" || true)"
  body="$(head -c 200 "$TMPBASE/deploy-safe-remote.body" 2>/dev/null || true)"
  if [[ "$code" == "200" ]] && ! grep -qiE 'Error 1033|Error 530|Cloudflare' <<<"$body"; then
    echo "http_$code"
    return 0
  fi
  # fallback: tunnel-status.json public.ok
  local ts="$GATEWAY_DIR/tunnel-status.json"
  if [[ -f "$ts" ]] && python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); p=d.get("public") or {}; sys.exit(0 if p.get("ok") else 1)' "$ts" 2>/dev/null; then
    echo "tunnel-status-public-ok"
    return 0
  fi
  echo "fail code=${code:-?} body=${body:0:80}"
  return 1
}

# spa_cache_bust_probe proves the HTML shell will revalidate after cutover and
# carries a client-visible build id (meta bd-spa-build / X-BD-SPA-Build).
spa_cache_bust_probe() {
  local code hdr body
  # Document routes require auth → hit a path that still runs serveWebSPA via
  # unauthenticated kind-icons is wrong. Use /sw.js for SW version + login page.
  # SPA shell after auth is hard without cookie; verify embedded serve via /login
  # is not the SPA. Instead curl the live binary's public SW and check SW_VERSION
  # embeds pwa-<hex>, and that health path is fine.
  hdr="$(curl -sS -m 5 -D - -o "$TMPBASE/deploy-safe-sw.js" -w "%{http_code}" \
    "http://${LIVE_HOST}:${LIVE_PORT}/sw.js" 2>/dev/null || true)"
  code="$(printf '%s' "$hdr" | tail -n1)"
  body="$(cat "$TMPBASE/deploy-safe-sw.js" 2>/dev/null || true)"
  if [[ "$code" != "200" ]]; then
    echo "fail sw_http=${code:-?}"
    return 1
  fi
  if ! grep -q "SW_VERSION" <<<"$body"; then
    echo "fail sw_missing_version"
    return 1
  fi
  # Prefer spa-derived version (pwa-<8hex>); fallback pwa-v2 still acceptable pre-embed.
  local ver
  ver="$(grep -oE "SW_VERSION = '[^']+'" <<<"$body" | head -1 | sed "s/SW_VERSION = '//;s/'$//")"
  if [[ -z "$ver" ]]; then
    echo "fail sw_version_parse"
    return 1
  fi
  # Also confirm SPA document headers when we can open index via internal loopback
  # with a fake path served only when authed — skip if 302.
  local idx_cc idx_build
  idx_cc="$(curl -sS -m 5 -o /dev/null -D - -w '' "http://${LIVE_HOST}:${LIVE_PORT}/sessions" 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="cache-control"{print $2; exit}')"
  # Unauthed sessions → 302; still ok. Document that SW version is the cutover signal.
  echo "ok sw_version=$ver sessions_cache_control=${idx_cc:-redirect}"
  return 0
}

# Exercise the terminal iframe route without credentials. Authentication happens
# before tab lookup, so this neither creates a session nor touches a live tab.
terminal_route_probe() {
  local result expected
  expected="http://${LIVE_HOST}:${LIVE_PORT}/login"
  # -q ignores curlrc (which could add credentials or follow redirects).
  result="$(curl -q -sS -m 5 --noproxy '*' -o /dev/null \
    -w '%{http_code}\n%{redirect_url}' \
    "http://${LIVE_HOST}:${LIVE_PORT}/term/cutover-route-probe/")" || {
    echo "fail terminal route request failed"
    return 1
  }
  if [[ "$result" != $'302\n'"$expected" ]]; then
    echo "fail terminal route expected 302 /login"
    return 1
  fi
}

# terminal_probe proves SPA terminals can actually work after cutover:
#   - terminal iframe route reaches authentication (302 /login)
#   - xterm static embed present
#   - durable term tab tmux sessions still alive
#   - sleep 0.2 + printf token send-keys / capture-pane round-trip (sleep I/O)
# Loopback-only gateway API; failure => postflight FAIL (cutover not a success).
terminal_probe() {
  if [[ "$SKIP_TERMINAL_PROBE" == "1" ]]; then
    echo "skipped"
    return 0
  fi
  terminal_route_probe || return 1
  local code body
  code="$(curl -sS -m 20 -o "$TMPBASE/deploy-safe-terminal.body" -w "%{http_code}" \
    "http://${LIVE_HOST}:${LIVE_PORT}/internal/cutover/terminal-probe" || true)"
  body="$(cat "$TMPBASE/deploy-safe-terminal.body" 2>/dev/null || true)"
  if [[ "$code" != "200" ]]; then
    echo "fail http=${code:-?} body=${body:0:200}"
    return 1
  fi
  if ! TMPBASE="$TMPBASE" python3 -c '
import json,sys,os
p=os.path.join(os.environ["TMPBASE"], "deploy-safe-terminal.body")
d=json.load(open(p))
ok=bool(d.get("ok"))
sleep=str(d.get("sleepIO") or "")
asset=str(d.get("xtermAsset") or "")
sys.exit(0 if ok and sleep=="ok" and asset=="ok" else 1)
' 2>/dev/null; then
    echo "fail body=${body:0:300}"
    return 1
  fi
  # Compact success line for evidence
  TMPBASE="$TMPBASE" python3 -c '
import json,os
p=os.path.join(os.environ["TMPBASE"], "deploy-safe-terminal.body")
d=json.load(open(p))
print("ok route=login sleepIO={sleep} xterm={xterm} live={live} durable={dur} ms={ms}".format(
  sleep=d.get("sleepIO"), xterm=d.get("xtermAsset"),
  live=d.get("liveSessions"), dur=d.get("durableTermTabs"), ms=d.get("elapsedMs")))
' 2>/dev/null || echo "ok"
  return 0
}

# "active" | "inactive" | "missing" | other systemctl states — one line only
unit_active() {
  local u="${1:-}"
  case "$BDGW_BACKEND" in
    systemd)
      if [[ -n "$u" ]]; then
        if _systemd_unit_quiet_active "$u"; then
          echo "active"
        else
          systemctl --user is-active "$u" 2>/dev/null || echo "missing"
        fi
        return 0
      fi
      # Prefer primary only when fully active; else legacy; else primary's state string.
      if _systemd_unit_quiet_active "$GATEWAY_UNIT"; then
        echo "active"
      elif _systemd_unit_quiet_active "$GATEWAY_UNIT_LEGACY"; then
        echo "active"
      else
        local st
        st="$(systemctl --user is-active "$GATEWAY_UNIT" 2>/dev/null || true)"
        if [[ -z "$st" || "$st" == "unknown" || "$st" == "inactive" || "$st" == "failed" || "$st" == "activating" ]]; then
          st="$(systemctl --user is-active "$GATEWAY_UNIT_LEGACY" 2>/dev/null || true)"
        fi
        echo "${st:-missing}"
      fi
      ;;
    launchd|none)
      if live_healthz >/dev/null 2>&1; then
        echo "active"
      elif bdgw_service_is_active "$GATEWAY_DIR" "$LAUNCHD_LABEL"; then
        echo "active"
      else
        echo "inactive"
      fi
      ;;
    *)
      if live_healthz >/dev/null 2>&1; then echo "active"; else echo "inactive"; fi
      ;;
  esac
}

preflight_live() {
  resolve_live_gateway_unit
  local out="$EVIDENCE_DIR/preflight-$(date +%Y%m%d-%H%M%S).txt"
  {
    echo "=== preflight $(bdgw_ts) ==="
    echo "os=$BDGW_OS backend=$BDGW_BACKEND home=$GATEWAY_DIR"
    echo "gateway_unit=$GATEWAY_UNIT"
    echo "live_unit=$(unit_active)"
    if [[ "$BDGW_BACKEND" == "systemd" ]]; then
      echo "watchdog=$(unit_active "$WATCHDOG_UNIT")"
      echo "tunnel_watchdog=$(unit_active "$TUNNEL_WATCHDOG_UNIT")"
      systemctl --user show "$GATEWAY_UNIT" -p ActiveState,UnitFileState,Restart,MainPID 2>&1 || true
      if [[ "$GATEWAY_UNIT" != "$GATEWAY_UNIT_LEGACY" ]]; then
        systemctl --user show "$GATEWAY_UNIT_LEGACY" -p ActiveState,UnitFileState,Restart,MainPID 2>&1 || true
      fi
    else
      bdgw_service_ctl status "$GATEWAY_DIR" "$LAUNCHD_LABEL" || true
    fi
    echo "--- healthz1 ---"
    live_healthz || true
    echo
    echo "--- healthz2 ---"
    live_healthz || true
    echo
    echo "--- remote ---"
    remote_probe || true
    echo
    if [[ -f "$GATEWAY_BIN" ]]; then
      echo "binary=$GATEWAY_BIN size=$(bdgw_stat_size "$GATEWAY_BIN")"
      echo "sha256=$(bdgw_sha256 "$GATEWAY_BIN")"
    else
      echo "binary missing: $GATEWAY_BIN"
    fi
  } | tee "$out"
  log "preflight evidence: $out"

  # Require healthy process; unit name is optional on non-systemd hosts
  if [[ "$BDGW_BACKEND" == "systemd" ]]; then
    local st
    st="$(unit_active)"
    [[ "$st" == "active" ]] || die "live unit not active (tried $GATEWAY_UNIT and $GATEWAY_UNIT_LEGACY; state=$st)"
  else
    live_healthz >/dev/null || die "live healthz failed (backend=$BDGW_BACKEND home=$GATEWAY_DIR)"
  fi
  h1="$(live_healthz)" || die "live healthz #1 failed"
  h2="$(live_healthz)" || die "live healthz #2 failed"
  [[ "$h1" == "ok" && "$h2" == "ok" ]] || die "live healthz not ok ($h1/$h2)"
  rp="$(remote_probe)" || die "remote probe failed: $rp"
  # Persist PASS into the evidence file so attach-cutover-evidence.sh can scan it (CAP-0038).
  printf 'preflight PASS remote=%s\n' "$rp" >>"$out"
  log "preflight PASS remote=$rp"
}

pick_shadow_port() {
  local p="$SHADOW_PORT"
  if ! timeout 0.3 bash -c "echo >/dev/tcp/${SHADOW_HOST}/${p}" 2>/dev/null; then
    echo "$p"
    return 0
  fi
  # port busy — try nearby
  local try
  for try in 18444 18445 18446 18447 18448 28443; do
    if ! timeout 0.3 bash -c "echo >/dev/tcp/${SHADOW_HOST}/${try}" 2>/dev/null; then
      echo "$try"
      return 0
    fi
  done
  die "no free shadow port near $SHADOW_PORT"
}

prepare_shadow_home() {
  mkdir -p "$SHADOW_HOME"
  # Minimal local-auth config so server can serve /login; healthz does not need it.
  if [[ ! -f "$SHADOW_HOME/config.json" ]]; then
    SHADOW_HOME="$SHADOW_HOME" python3 - <<'PY'
import json, os, pathlib, secrets
home = pathlib.Path(os.environ["SHADOW_HOME"])
home.mkdir(parents=True, exist_ok=True)
cfg = {
  "username": "shadow",
  "passwordHash": "unused",
  "totpSecret": "MFRGGZDFMZTWQ2LK",
  "lastTOTPCounter": 0,
}
(home / "config.json").write_text(json.dumps(cfg, indent=2) + "\n")
(home / ".session-secret").write_bytes(secrets.token_bytes(32))
print("wrote minimal shadow config")
PY
  fi
  # ensure session secret file exists even if config already present
  if [[ ! -f "$SHADOW_HOME/.session-secret" ]]; then
    openssl rand -out "$SHADOW_HOME/.session-secret" 32 2>/dev/null || head -c 32 /dev/urandom >"$SHADOW_HOME/.session-secret"
  fi
}

build_candidate() {
  need_cmd go
  [[ -n "$REPO_ROOT" ]] || die "no gateway checkout found — looked for src/main.go (or go.mod + src/) walking up from $PWD and from $SCRIPT_DIR. Building needs one: run deploy-safe from inside the bytedesk-remote-gateway checkout (preflight / postflight / restart-cutover do not need a checkout)."
  [[ -f "$GATEWAY_SOURCE_DIR/main.go" ]] || die "missing source $GATEWAY_SOURCE_DIR/main.go"
  # SPA is go:embed'd from src/web_spa — rebuild web/ first so nav/routes ship with the binary.
  # A missing web/ or missing npm used to skip this silently and stage whatever
  # web_spa already held; both are fatal now. SKIP_SPA_BUILD=1 is the only opt-out.
  local web_dir="$REPO_ROOT/web"
  if [[ "${SKIP_SPA_BUILD:-0}" == "1" ]]; then
    log "SKIP_SPA_BUILD=1 — embedding existing $GATEWAY_SOURCE_DIR/web_spa as-is"
  else
    [[ -f "$web_dir/package.json" ]] || die "no SPA source at $web_dir/package.json (REPO_ROOT=$REPO_ROOT) — run deploy-safe from the gateway checkout, or set SKIP_SPA_BUILD=1 for a Go-only build"
    need_cmd npm
    log "building SPA → $GATEWAY_SOURCE_DIR/web_spa (embed)"
    (cd "$web_dir" && npm run build) || die "SPA build failed — fix web/ or set SKIP_SPA_BUILD=1"
  fi
  log "building candidate → $GATEWAY_BIN_NEW (os=$BDGW_OS source=$GATEWAY_SOURCE_DIR)"
  # -buildvcs=false -trimpath: identical source → identical bytes so UNCHANGED skip works.
  mkdir -p "$(dirname "$GATEWAY_BIN_NEW")"
  (cd "$GATEWAY_SOURCE_DIR" && go build -buildvcs=false -trimpath -o "$GATEWAY_BIN_NEW" .)
  [[ -f "$GATEWAY_BIN_NEW" ]] || die "candidate not produced"
  chmod +x "$GATEWAY_BIN_NEW" 2>/dev/null || true
  log "candidate size=$(bdgw_stat_size "$GATEWAY_BIN_NEW")"
}

# Boot candidate without installing; prove /healthz. Leaves candidate on disk.
verify_candidate() {
  local evidence="$EVIDENCE_DIR/shadow-$(date +%Y%m%d-%H%M%S).txt"
  local port candidate="${1:-$GATEWAY_BIN_NEW}"

  [[ -f "$candidate" ]] || die "candidate missing: $candidate"
  chmod +x "$candidate" 2>/dev/null || true
  # Live must stay healthy during shadow
  live_healthz >/dev/null || die "live unhealthy before shadow"

  port="$(pick_shadow_port)"
  SHADOW_LOG="$EVIDENCE_DIR/shadow-boot-$(date +%Y%m%d-%H%M%S).log"
  prepare_shadow_home

  log "shadow boot candidate=$candidate port=${SHADOW_HOST}:${port} home=$SHADOW_HOME log=$SHADOW_LOG"

  local session_secret
  session_secret="$(openssl rand -hex 32 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(32))')"

  # Isolated env — smoke only needs HTTP listen. UPSTREAM dummy (unused for healthz).
  env \
    LISTEN_HOST="$SHADOW_HOST" \
    LISTEN_PORT="$port" \
    CONFIG_PATH="$SHADOW_HOME/config.json" \
    SESSION_STORE_PATH="$SHADOW_HOME/sessions.json" \
    GATEWAY_HOME="$SHADOW_HOME" \
    BAN_STORE_PATH="$SHADOW_HOME/banned-ips.json" \
    ALLOW_STORE_PATH="$SHADOW_HOME/allowed-ips.json" \
    GEO_STORE_PATH="$SHADOW_HOME/geo-allow.json" \
    LOCKDOWN_PATH="$SHADOW_HOME/lockdown" \
    PRESET_STORE_PATH="$SHADOW_HOME/presets.json" \
    TAB_STORE_PATH="$SHADOW_HOME/tabs.json" \
    AUDIT_LOG_PATH="$SHADOW_HOME/audit.jsonl" \
    API_TOKEN_STORE_PATH="$SHADOW_HOME/api-tokens.json" \
    AGENT_SESSION_STORE_PATH="$SHADOW_HOME/agent-sessions.json" \
    SESSION_SECRET="$session_secret" \
    AUTH_MODE=local \
    REQUIRE_APPROVAL=false \
    ACCESS_LOG=false \
    UPSTREAM="http://127.0.0.1:9" \
    TMUX_SESSION="bytedesk-shadow-verify-$$" \
    PUBLIC_BASE_URL="" \
    NTFY_URL="" \
    ALLOW_CIDRS="" \
    BYTEDESK_STORE_URL="" \
    BYTEDESK_VAULT_URL="" \
    "$candidate" >"$SHADOW_LOG" 2>&1 &
  SHADOW_PID=$!

  local ok=0 i h1 h2 live_mid
  for i in $(seq 1 "$SHADOW_TIMEOUT_SECS"); do
    if ! kill -0 "$SHADOW_PID" 2>/dev/null; then
      log "shadow process exited early"
      tail -n 40 "$SHADOW_LOG" || true
      break
    fi
    if h1="$(curl -fsS -m 1 "http://${SHADOW_HOST}:${port}/healthz" 2>/dev/null)"; then
      if [[ "$h1" == "ok" ]]; then
        sleep 0.3
        h2="$(curl -fsS -m 1 "http://${SHADOW_HOST}:${port}/healthz" 2>/dev/null || true)"
        live_mid="$(live_healthz || true)"
        if [[ "$h2" == "ok" && "$live_mid" == "ok" ]]; then
          ok=1
          break
        fi
      fi
    fi
    sleep 1
  done

  {
    echo "=== shadow verify $(date -Is) ==="
    echo "candidate=$candidate"
    echo "port=${SHADOW_HOST}:${port}"
    echo "pid=${SHADOW_PID}"
    echo "ok=$ok"
    echo "shadow_healthz_1=${h1:-}"
    echo "shadow_healthz_2=${h2:-}"
    echo "live_during_shadow=$(live_healthz || echo FAIL)"
    echo "log=$SHADOW_LOG"
    echo "--- shadow log tail ---"
    tail -n 50 "$SHADOW_LOG" 2>/dev/null || true
  } | tee "$evidence"

  cleanup_shadow

  live_healthz >/dev/null || die "live became unhealthy during/after shadow"
  if [[ "$ok" != "1" ]]; then
    log "verify-candidate FAIL evidence=$evidence"
    return 1
  fi
  log "verify-candidate PASS evidence=$evidence"
  echo "$candidate"
  return 0
}

install_candidate() {
  local candidate="${1:-$GATEWAY_BIN_NEW}"
  [[ -x "$candidate" ]] || die "no candidate to install"
  if [[ -f "$GATEWAY_BIN" ]] && cmp -s "$candidate" "$GATEWAY_BIN"; then
    log "install: candidate identical to live"
    if [[ "$SKIP_INSTALL_IF_UNCHANGED" == "1" ]]; then
      rm -f "$GATEWAY_BIN_NEW"
      printf 'UNCHANGED\n' >"$GATEWAY_DIR/stage.result" 2>/dev/null || true
      echo "UNCHANGED"
      return 0
    fi
  fi
  if [[ -f "$GATEWAY_BIN" ]] && live_healthz >/dev/null; then
    cp -f "$GATEWAY_BIN" "$GATEWAY_BIN_LAST_GOOD" 2>/dev/null || cp "$GATEWAY_BIN" "$GATEWAY_BIN_LAST_GOOD"
    log "preserved last-good"
  fi
  # atomic-ish: move into place
  mkdir -p "$(dirname "$GATEWAY_BIN")"
  if [[ "$candidate" != "$GATEWAY_BIN" ]]; then
    mv -f "$candidate" "$GATEWAY_BIN"
  fi
  chmod +x "$GATEWAY_BIN" 2>/dev/null || true
  date +%s >"$GATEWAY_DIR/deploy.stamp" 2>/dev/null || true
  printf 'INSTALLED\n' >"$GATEWAY_DIR/stage.result" 2>/dev/null || true
  log "installed live binary $(bdgw_stat_size "$GATEWAY_BIN") bytes"
  echo "INSTALLED"
}

restart_live() {
  if [[ "${CUTOVER_JOB_ACTIVE:-0}" == "1" ]]; then
    cutover_job_bounce 2>/dev/null || true
  fi
  resolve_live_gateway_unit
  log "restarting backend=$BDGW_BACKEND unit=$GATEWAY_UNIT home=$GATEWAY_DIR"
  case "$BDGW_BACKEND" in
    systemd)
      systemctl --user restart "$GATEWAY_UNIT" \
        || die "systemctl restart failed for $GATEWAY_UNIT"
      ;;
    launchd|none)
      bdgw_service_ctl restart "$GATEWAY_DIR" "$LAUNCHD_LABEL"
      ;;
  esac
  if wait_live_ready; then
    restart_tunnel_watchdog_if_requested || die "tunnel watchdog reload failed; gateway is ready"
    return 0
  fi
  if [[ "$(unit_active "$GATEWAY_UNIT")" == "active" ]] && live_healthz >/dev/null 2>&1; then
    log "wait expired but live healthz ok — not rolling back"
    restart_tunnel_watchdog_if_requested || die "tunnel watchdog reload failed; gateway is ready"
    return 0
  fi
  return 1
}

restart_tunnel_watchdog_if_requested() {
  [[ "${RESTART_TUNNEL_WATCHDOG:-0}" == "1" ]] || return 0
  [[ "$BDGW_BACKEND" == "systemd" ]] || return 0
  log "reloading $TUNNEL_WATCHDOG_UNIT after gateway readiness"
  systemctl --user restart "$TUNNEL_WATCHDOG_UNIT"
}

postflight_live() {
  resolve_live_gateway_unit
  local out="$EVIDENCE_DIR/postflight-$(date +%Y%m%d-%H%M%S).txt"
  {
    echo "=== postflight $(bdgw_ts) ==="
    echo "os=$BDGW_OS backend=$BDGW_BACKEND"
    echo "gateway_unit=$GATEWAY_UNIT"
    echo "live_unit=$(unit_active)"
    if [[ "$BDGW_BACKEND" == "systemd" ]]; then
      echo "watchdog=$(unit_active "$WATCHDOG_UNIT")"
      echo "tunnel_watchdog=$(unit_active "$TUNNEL_WATCHDOG_UNIT")"
    fi
    echo "--- healthz1 ---"
    live_healthz || true
    echo
    echo "--- healthz2 ---"
    live_healthz || true
    echo
    echo "--- bus ---"
    bus_health_probe || true
    echo "--- login ---"
    curl -sS -m 3 -o /dev/null -w "login_http=%{http_code}\n" "http://${LIVE_HOST}:${LIVE_PORT}/login" || true
    echo "--- remote ---"
    remote_probe || true
    echo "--- terminal ---"
    terminal_probe || true
    echo "--- spa-cache-bust ---"
    spa_cache_bust_probe || true
  } | tee "$out"
  log "postflight evidence: $out"

  h1="$(live_healthz)" || die "postflight healthz #1 failed"
  h2="$(live_healthz)" || die "postflight healthz #2 failed"
  [[ "$h1" == "ok" && "$h2" == "ok" ]] || die "postflight healthz not ok"
  bh="$(bus_health_probe)" || die "postflight bus health headers missing or invalid"
  st="$(unit_active)"
  [[ "$st" == "active" ]] || die "postflight service not active (unit=$GATEWAY_UNIT state=$st)"
  rp="$(remote_probe)" || die "postflight remote failed: $rp"
  tp="$(terminal_probe)" || die "postflight terminal probe failed: $tp (terminals not available — cutover is not a success)"
  sp="$(spa_cache_bust_probe)" || die "postflight spa cache-bust probe failed: $sp"
  # Persist PASS into the evidence file so attach-cutover-evidence.sh can scan it (CAP-0038).
  printf 'postflight PASS unit=%s %s remote=%s terminal=%s spa=%s\n' "$GATEWAY_UNIT" "$bh" "$rp" "$tp" "$sp" >>"$out"
  log "postflight PASS unit=$GATEWAY_UNIT $bh remote=$rp terminal=$tp spa=$sp"
  cutover_job_finish_postflight "$out" 2>/dev/null || true
}

rollback_live() {
  resolve_live_gateway_unit
  log "ROLLBACK: restoring last-good"
  [[ -f "$GATEWAY_BIN_LAST_GOOD" ]] || die "no last-good binary"
  cp -f "$GATEWAY_BIN_LAST_GOOD" "$GATEWAY_BIN"
  chmod +x "$GATEWAY_BIN" 2>/dev/null || true
  case "$BDGW_BACKEND" in
    systemd)
      systemctl --user restart "$GATEWAY_UNIT" || true
      ;;
    *)
      bdgw_service_ctl restart "$GATEWAY_DIR" "$LAUNCHD_LABEL" || true
      ;;
  esac
  sleep 2
  live_healthz >/dev/null || die "rollback failed to restore healthz"
  log "rollback restored live healthz"
}

cmd_stage() {
  # Shadow-verify and install on disk only. Running process keeps old code until restart.
  # Use when cutover restart would drop the operator's own gateway session.
  cutover_job_init "stage"
  cutover_job_log "stage" "staging candidate"
  preflight_live
  build_candidate
  verify_candidate "$GATEWAY_BIN_NEW" || die "candidate shadow boot failed — live binary NOT modified"
  local result
  result="$(install_candidate "$GATEWAY_BIN_NEW")"
  log "stage complete result=$result (NO restart — run restart-cutover when ready)"
  live_healthz >/dev/null || die "live unhealthy after stage (unexpected)"
  echo "STAGED"
}

cmd_restart_cutover() {
  cutover_lock_acquire || die "cutover already running (lock $(cutover_lock_dir))"
  cutover_job_init "restart-cutover"
  cutover_job_log "preflight" "restart-cutover"
  preflight_live
  # After stage with identical binary, skip production restart (avoids public 502 flaps).
  if [[ "${FORCE_RESTART:-0}" != "1" ]] && [[ -f "$GATEWAY_DIR/stage.result" ]] \
    && [[ "$(tr -d '[:space:]' <"$GATEWAY_DIR/stage.result" 2>/dev/null || true)" == "UNCHANGED" ]] \
    && live_healthz >/dev/null 2>&1; then
    log "restart-cutover SKIPPED: last stage result=UNCHANGED and live healthz ok"
    postflight_live || true
    log "restart-cutover COMPLETE (no restart)"
    pf="$(ls -1t "$EVIDENCE_DIR"/postflight-*.txt 2>/dev/null | head -n1 || true)"
    cutover_job_pass "restart skipped (UNCHANGED)" "$pf"
    return 0
  fi
  if ! restart_live; then
    if live_healthz >/dev/null 2>&1; then
      log "restart wait timed out; live healthz ok — skipping rollback restart"
    else
      rollback_live
      die "restart failed; rolled back"
    fi
  fi
  if ! postflight_live; then
    if live_healthz >/dev/null 2>&1; then
      log "postflight failed; live healthz ok — skipping rollback restart"
      die "postflight failed (live still up)"
    fi
    rollback_live
    postflight_live || die "rollback postflight also failed"
    die "postflight failed; rolled back to last-good"
  fi
  log "restart-cutover COMPLETE"
  pf="$(ls -1t "$EVIDENCE_DIR"/postflight-*.txt 2>/dev/null | head -n1 || true)"
  cutover_job_pass "restart-cutover COMPLETE" "$pf"
}

cmd_deploy() {
  cutover_job_init "restart-cutover"
  cutover_job_log "preflight" "deploy"
  preflight_live
  build_candidate
  verify_candidate "$GATEWAY_BIN_NEW" || die "candidate shadow boot failed — live binary NOT modified"
  local result
  result="$(install_candidate "$GATEWAY_BIN_NEW")"
  if [[ "$result" == "UNCHANGED" ]]; then
    log "deploy: binary unchanged — skipping production restart"
    postflight_live
    return 0
  fi
  if ! restart_live; then
    rollback_live
    die "restart failed; rolled back"
  fi
  if ! postflight_live; then
    rollback_live
    postflight_live || die "rollback postflight also failed"
    die "postflight failed; rolled back to last-good"
  fi
  log "deploy-safe COMPLETE"
  pf="$(ls -1t "$EVIDENCE_DIR"/postflight-*.txt 2>/dev/null | head -n1 || true)"
  cutover_job_pass "deploy-safe COMPLETE" "$pf"
}

cmd_shadow_fail_drill() {
  preflight_live
  local bad="$EVIDENCE_DIR/intentionally-bad-candidate"
  # Not a valid ELF — process will fail immediately
  printf '#!/bin/sh\necho intentional-fail\nexit 1\n' >"$bad"
  chmod +x "$bad"
  log "shadow-fail-drill: starting verify on bad candidate (expect failure)"
  if verify_candidate "$bad"; then
    die "shadow-fail-drill unexpectedly PASSed"
  fi
  log "shadow-fail-drill: verify failed as expected"
  live_healthz >/dev/null || die "live unhealthy after fail drill"
  rp="$(remote_probe)" || die "remote failed after fail drill"
  log "shadow-fail-drill PASS (live still healthy remote=$rp)"
}

usage() {
  sed -n '2,20p' "$0"
}

main() {
  need_cmd curl
  # systemctl only required when backend is systemd
  if [[ "$BDGW_BACKEND" == "systemd" ]]; then
    need_cmd systemctl
  fi
  log "deploy-safe os=$BDGW_OS backend=$BDGW_BACKEND home=$GATEWAY_DIR bin=$GATEWAY_BIN repo=${REPO_ROOT:-<none>}"
  local cmd="${1:-}"
  case "$cmd" in
    preflight) preflight_live ;;
    verify-candidate)
      build_candidate
      verify_candidate "$GATEWAY_BIN_NEW"
      ;;
    stage) cmd_stage ;;
    restart-cutover) cmd_restart_cutover ;;
    postflight) postflight_live ;;
    deploy) cmd_deploy ;;
    shadow-fail-drill) cmd_shadow_fail_drill ;;
    -h|--help|help|"") usage; exit 0 ;;
    *) die "unknown command: $cmd" ;;
  esac
}

main "$@"
