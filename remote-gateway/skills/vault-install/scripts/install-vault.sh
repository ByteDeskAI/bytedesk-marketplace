#!/usr/bin/env bash
# Platforms: Linux, macOS, Windows (Git Bash/MSYS/WSL + run.ps1).
# ByteDesk Vault installer — independently deployable identity directory (ADR 0012 / 0013).
#
# Canonical product: https://github.com/ByteDeskAI/bytedesk-vault
#   Prefer: curl -fsSL https://get.bytedesk.ai/vault | sh
#   Or clone bytedesk-vault and run ./scripts/install.sh
# This skill script is a self-contained operator path (setup plugin) with the
# same resolution order as monorepo scripts/commercial/install-vault.sh.
# Monorepo vault/ remains transitional dual-path only.
#
# One-liner (when hosted):
#   curl -fsSL https://get.bytedesk.ai/vault | sh
#   curl -fsSL https://get.bytedesk.ai/vault | sh -s -- --bind 127.0.0.1:18765 --start
#
# Offline / local artifact:
#   BYTEDESK_VAULT_ARTIFACT=./dist/bytedesk-vault-linux-amd64 \
#     ./scripts/install-vault.sh --home "$HOME/.bytedesk-vault"
#
# Env:
#   BYTEDESK_VAULT_ARTIFACT     path to prebuilt vault-server binary
#   BYTEDESK_VAULT_RELEASE_BASE public origin (default: https://get.bytedesk.ai/releases/latest)
#   BYTEDESK_VAULT_RELEASE_URL  HTTPS URL of binary to download
#   BYTEDESK_VAULT_HOME         default home (also --home)
#   VAULT_HOME                  alias for home
#   BYTEDESK_VAULT_PUBLIC_URL   public URL written into enroll packages (optional)
#   BYTEDESK_VAULT_SRC          path to bytedesk-vault checkout (or monorepo root) for
#                               build-from-source. Resolution order when unset:
#                                 1) sibling ../bytedesk-vault (next to monorepo main)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# When piped via curl|sh, BASH_SOURCE may be empty or /dev/fd — treat as remote.
# Walk up for monorepo checkout (optional offline dist/).
REPO_ROOT=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  _walk="$SCRIPT_DIR"
  for _ in 1 2 3 4 5 6 7 8; do
    if [[ -f "$_walk/src/main.go" ]]; then
      REPO_ROOT="$_walk"
      break
    fi
    # Standalone bytedesk-vault module as walk root (cmd/vault-server + go.mod).
    if [[ -f "$_walk/cmd/vault-server/main.go" && -f "$_walk/go.mod" ]]; then
      # Prefer not setting REPO_ROOT to vault product unless no monorepo found later.
      :
    fi
    _parent="$(cd "$_walk/.." 2>/dev/null && pwd)" || break
    [[ "$_parent" == "$_walk" ]] && break
    _walk="$_parent"
  done
fi

is_vault_module() {
  [[ -n "${1:-}" && -f "$1/cmd/vault-server/main.go" && -f "$1/go.mod" ]]
}

# Resolve bytedesk-vault product for build-from-source (sibling / BYTEDESK_VAULT_SRC only).
resolve_vault_module() {
  local c main_repo common
  local candidates=()

  if [[ -n "${BYTEDESK_VAULT_SRC:-}" ]]; then
    candidates+=("$BYTEDESK_VAULT_SRC")
  fi

  if [[ -n "$REPO_ROOT" ]]; then
    candidates+=("$REPO_ROOT/../bytedesk-vault")
    # Worktree: .worktrees/<name> → monorepo main (../..) → sibling (../../..)
    if [[ "$REPO_ROOT" == */.worktrees/* ]]; then
      candidates+=("$REPO_ROOT/../../../bytedesk-vault")
    fi
    if command -v git >/dev/null 2>&1; then
      common="$(git -C "$REPO_ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
      if [[ -n "$common" ]]; then
        if [[ "$common" != /* ]]; then
          common="$(cd "$REPO_ROOT/$common" 2>/dev/null && pwd)" || \
            common="$(cd "$REPO_ROOT" && cd "$common" 2>/dev/null && pwd)" || common=""
        fi
        if [[ -n "$common" ]]; then
          main_repo="$(cd "$(dirname "$common")" && pwd)"
          candidates+=("$main_repo/../bytedesk-vault")
        fi
      fi
    fi
  fi

  if [[ -n "$SCRIPT_DIR" ]]; then
    # skill path under monorepo (or worktree): walk toward sibling product
    candidates+=("$SCRIPT_DIR/../../../../../bytedesk-vault")
    candidates+=("$SCRIPT_DIR/../../../../../../bytedesk-vault")
    candidates+=("$SCRIPT_DIR/../../../../../../../bytedesk-vault")
  fi

  for c in "${candidates[@]}"; do
    [[ -n "$c" ]] || continue
    if is_vault_module "$c"; then
      printf '%s\n' "$(cd "$c" && pwd)"
      return 0
    fi
  done
  return 1
}

VAULT_MODULE=""
VAULT_MODULE="$(resolve_vault_module 2>/dev/null || true)"

VAULT_HOME_DEFAULT="${BYTEDESK_VAULT_HOME:-${VAULT_HOME:-${HOME}/.bytedesk-vault}}"
VAULT_HOME="$VAULT_HOME_DEFAULT"
BIND_DEFAULT="127.0.0.1:18765"
BIND="$BIND_DEFAULT"
ORG_ID="default"
PUBLIC_URL="${BYTEDESK_VAULT_PUBLIC_URL:-}"
START_NOW=0

die() { echo "install-vault: error: $*" >&2; exit 1; }
warn() { echo "install-vault: warning: $*" >&2; }
info() { echo "install-vault: $*"; }

usage() {
  cat <<'EOF'
Usage: install-vault.sh [options]

  --home DIR       Product home (default: $HOME/.bytedesk-vault)
  --bind HOST:PORT Private listen address (default: 127.0.0.1:18765)
  --org ID         Organization id for the directory (default: default)
  --public-url URL Vault base URL returned in enroll packages
  --start          Start vault after install (systemd --user or run.sh)
  -h, --help       Show this help

Does NOT require Tailscale, Funnel, Cloudflare Tunnel, or a monorepo checkout
when BYTEDESK_VAULT_ARTIFACT, release download, or BYTEDESK_VAULT_RELEASE_URL is set.

Primary product path: get.bytedesk.ai (TeamCity vault release-publish).
GitHub is source control only. Build-from-source uses sibling bytedesk-vault.

Artifact resolution order:
  1. BYTEDESK_VAULT_ARTIFACT (local path)
  2. BYTEDESK_VAULT_RELEASE_URL (download)
  3. BYTEDESK_VAULT_RELEASE_BASE / bytedesk-vault-\$OS-\$ARCH
     (default https://get.bytedesk.ai/releases/latest — TeamCity via proxy)
  4. Local dist/ next to this script or gateway root
  5. Build from source when go is available:
       BYTEDESK_VAULT_SRC → sibling ../bytedesk-vault

Canonical release/build: bytedesk-vault repo ./scripts/release.sh

One-liner:
  curl -fsSL https://get.bytedesk.ai/vault | sh
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --home)
      [[ $# -ge 2 ]] || die "--home requires a directory"
      VAULT_HOME="$2"
      shift 2
      ;;
    --bind)
      [[ $# -ge 2 ]] || die "--bind requires HOST:PORT"
      BIND="$2"
      shift 2
      ;;
    --org)
      [[ $# -ge 2 ]] || die "--org requires an id"
      ORG_ID="$2"
      shift 2
      ;;
    --public-url)
      [[ $# -ge 2 ]] || die "--public-url requires a URL"
      PUBLIC_URL="$2"
      shift 2
      ;;
    --start)
      START_NOW=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1 (see --help)"
      ;;
  esac
done

if [[ "$BIND" != *:* ]]; then
  die "--bind must be HOST:PORT (got: $BIND)"
fi
LISTEN_HOST="${BIND%:*}"
LISTEN_PORT="${BIND##*:}"
[[ -n "$LISTEN_HOST" && -n "$LISTEN_PORT" ]] || die "invalid --bind: $BIND"
[[ "$LISTEN_PORT" =~ ^[0-9]+$ ]] || die "invalid port in --bind: $BIND"

if [[ -z "$PUBLIC_URL" ]]; then
  PUBLIC_URL="http://${LISTEN_HOST}:${LISTEN_PORT}"
fi

# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/platform.sh"

detect_arch() { bdgw_detect_arch; }
detect_os() { bdgw_detect_os; }

OS="$(detect_os)"
ARCH="$(detect_arch)"
ARTIFACT_EXT=""
[[ "$OS" == "windows" ]] && ARTIFACT_EXT=".exe"
ARTIFACT_NAME="bytedesk-vault-${OS}-${ARCH}${ARTIFACT_EXT}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

try_download() {
  local url="$1" dest="$2"
  need_cmd curl || return 1
  if curl -fsSL "$url" -o "$dest" 2>/dev/null && [[ -s "$dest" ]]; then
    return 0
  fi
  rm -f "$dest" 2>/dev/null || true
  return 1
}

build_from_source() {
  need_cmd go || return 1
  local mod_dir="${VAULT_MODULE:-}"
  if [[ -z "$mod_dir" ]]; then
    mod_dir="$(resolve_vault_module)" || return 1
  fi
  is_vault_module "$mod_dir" || return 1

  local out_dir out
  if [[ -n "$REPO_ROOT" ]]; then
    out_dir="$REPO_ROOT/dist"
  else
    out_dir="$mod_dir/dist"
  fi
  out="${out_dir}/${ARTIFACT_NAME}"
  mkdir -p "$out_dir"
  info "building vault-server from source ($mod_dir) → $out"
  (
    cd "$mod_dir"
    env CGO_ENABLED=0 GOOS="$OS" GOARCH="$ARCH" \
      go build -buildvcs=false -trimpath -ldflags '-s -w' \
      -o "$out" ./cmd/vault-server
  ) || return 1
  chmod +x "$out" 2>/dev/null || chmod u+x "$out" || true
  printf '%s\n' "$out"
}

RELEASE_BASE="${BYTEDESK_VAULT_RELEASE_BASE:-https://get.bytedesk.ai/releases/latest}"
RELEASE_BASE="${RELEASE_BASE%/}"

resolve_artifact() {
  if [[ -n "${BYTEDESK_VAULT_ARTIFACT:-}" ]]; then
    [[ -f "$BYTEDESK_VAULT_ARTIFACT" ]] || die "BYTEDESK_VAULT_ARTIFACT not found: $BYTEDESK_VAULT_ARTIFACT"
    printf '%s\n' "$BYTEDESK_VAULT_ARTIFACT"
    return 0
  fi

  if [[ -n "${BYTEDESK_VAULT_RELEASE_URL:-}" ]]; then
    need_cmd curl || die "curl required to download BYTEDESK_VAULT_RELEASE_URL"
    local tmp
    tmp="$(mktemp)"
    info "downloading $BYTEDESK_VAULT_RELEASE_URL"
    curl -fsSL "$BYTEDESK_VAULT_RELEASE_URL" -o "$tmp" || die "download failed"
    printf '%s\n' "$tmp"
    return 0
  fi

  # Public multi-arch set (get.bytedesk.ai → TeamCity release-publish artifacts).
  local pub_url="${RELEASE_BASE}/${ARTIFACT_NAME}"
  local tmp_pub
  tmp_pub="$(mktemp)"
  info "trying release download: $pub_url"
  if try_download "$pub_url" "$tmp_pub"; then
    printf '%s\n' "$tmp_pub"
    return 0
  fi
  rm -f "$tmp_pub" 2>/dev/null || true

  local candidates=(
    "${REPO_ROOT}/dist/${ARTIFACT_NAME}"
    "${VAULT_MODULE}/dist/${ARTIFACT_NAME}"
    "${SCRIPT_DIR}/../../dist/${ARTIFACT_NAME}"
    "${SCRIPT_DIR}/../dist/${ARTIFACT_NAME}"
    "./dist/${ARTIFACT_NAME}"
    "./${ARTIFACT_NAME}"
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -n "$c" && -f "$c" ]]; then
      printf '%s\n' "$(cd "$(dirname "$c")" && pwd)/$(basename "$c")"
      return 0
    fi
  done

  local built
  if built="$(build_from_source)"; then
    printf '%s\n' "$built"
    return 0
  fi

  die "no vault binary found.
  Set BYTEDESK_VAULT_ARTIFACT=/path/to/${ARTIFACT_NAME}
  or BYTEDESK_VAULT_RELEASE_URL=https://...
  or ensure ${RELEASE_BASE}/${ARTIFACT_NAME} is published (TeamCity vault release-publish)
  or place a local release under dist/${ARTIFACT_NAME}
  or build from source:
       BYTEDESK_VAULT_SRC=/path/to/bytedesk-vault
       sibling checkout ../bytedesk-vault
  Canonical: bytedesk-vault ./scripts/release.sh + TeamCity
  GitHub Releases are not the commercial install path."
}

SRC_ARTIFACT="$(resolve_artifact)"
[[ -f "$SRC_ARTIFACT" ]] || die "artifact missing: $SRC_ARTIFACT"
[[ -s "$SRC_ARTIFACT" ]] || die "artifact is empty: $SRC_ARTIFACT"

info "home=$VAULT_HOME bind=$BIND org=$ORG_ID"
info "artifact=$SRC_ARTIFACT"

mkdir -p "$VAULT_HOME" "$VAULT_HOME/bin" "$VAULT_HOME/data"
chmod 700 "$VAULT_HOME" "$VAULT_HOME/data"

DEST_BIN="$VAULT_HOME/bin/bytedesk-vault"
[[ "$OS" == "windows" ]] && DEST_BIN="${DEST_BIN}.exe"
bdgw_install_bin "$SRC_ARTIFACT" "$DEST_BIN"
if [[ "$SRC_ARTIFACT" == /tmp/* || "$SRC_ARTIFACT" == "${TMPDIR:-/tmp}"/* ]]; then
  rm -f "$SRC_ARTIFACT" 2>/dev/null || true
fi
[[ -x "$DEST_BIN" ]] || die "installed binary is not executable: $DEST_BIN"

# control.env — do not clobber existing secrets / identity seal material paths
STATE_FILE="$VAULT_HOME/control.env"
if [[ ! -f "$STATE_FILE" ]]; then
  cat >"$STATE_FILE" <<EOF
# ByteDesk Vault control.env (private-first identity directory)
# Generated by scripts/commercial/install-vault.sh — do not commit.

VAULT_HOME=${VAULT_HOME}
BYTEDESK_VAULT_HOME=${VAULT_HOME}
LISTEN_HOST=${LISTEN_HOST}
LISTEN_PORT=${LISTEN_PORT}
VAULT_ORG=${ORG_ID}
VAULT_PUBLIC_URL=${PUBLIC_URL}
VAULT_DATA_DIR=${VAULT_HOME}/data
EOF
  chmod 600 "$STATE_FILE"
  info "wrote $STATE_FILE"
else
  info "preserving existing $STATE_FILE"
  grep -q '^LISTEN_HOST=' "$STATE_FILE" || printf 'LISTEN_HOST=%s\n' "$LISTEN_HOST" >>"$STATE_FILE"
  grep -q '^LISTEN_PORT=' "$STATE_FILE" || printf 'LISTEN_PORT=%s\n' "$LISTEN_PORT" >>"$STATE_FILE"
  grep -q '^VAULT_HOME=' "$STATE_FILE" || printf 'VAULT_HOME=%s\n' "$VAULT_HOME" >>"$STATE_FILE"
  grep -q '^BYTEDESK_VAULT_HOME=' "$STATE_FILE" || printf 'BYTEDESK_VAULT_HOME=%s\n' "$VAULT_HOME" >>"$STATE_FILE"
  grep -q '^VAULT_ORG=' "$STATE_FILE" || printf 'VAULT_ORG=%s\n' "$ORG_ID" >>"$STATE_FILE"
  grep -q '^VAULT_PUBLIC_URL=' "$STATE_FILE" || printf 'VAULT_PUBLIC_URL=%s\n' "$PUBLIC_URL" >>"$STATE_FILE"
  grep -q '^VAULT_DATA_DIR=' "$STATE_FILE" || printf 'VAULT_DATA_DIR=%s\n' "$VAULT_HOME/data" >>"$STATE_FILE"
  chmod 600 "$STATE_FILE"
fi

# shellcheck disable=SC1090
source "$STATE_FILE"
LISTEN_HOST="${LISTEN_HOST:-$LISTEN_HOST}"
LISTEN_PORT="${LISTEN_PORT:-$LISTEN_PORT}"
ORG_ID="${VAULT_ORG:-$ORG_ID}"
PUBLIC_URL="${VAULT_PUBLIC_URL:-$PUBLIC_URL}"
DATA_DIR="${VAULT_DATA_DIR:-$VAULT_HOME/data}"
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"

# run.sh always written — works without systemd
RUN_SH="$VAULT_HOME/run.sh"
cat >"$RUN_SH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
HOME_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
# shellcheck disable=SC1091
set -a
source "\$HOME_DIR/control.env"
set +a
export VAULT_HOME="\${VAULT_HOME:-\$HOME_DIR}"
export BYTEDESK_VAULT_HOME="\${BYTEDESK_VAULT_HOME:-\$VAULT_HOME}"
export VAULT_HOME_DATA="\${VAULT_DATA_DIR:-\$VAULT_HOME/data}"
LISTEN_HOST="\${LISTEN_HOST:-127.0.0.1}"
LISTEN_PORT="\${LISTEN_PORT:-18765}"
ORG="\${VAULT_ORG:-default}"
PUBLIC="\${VAULT_PUBLIC_URL:-http://\${LISTEN_HOST}:\${LISTEN_PORT}}"
exec "\$HOME_DIR/bin/bytedesk-vault" \\
  -listen "\${LISTEN_HOST}:\${LISTEN_PORT}" \\
  -data "\$VAULT_HOME_DATA" \\
  -org "\$ORG" \\
  -public-url "\$PUBLIC"
EOF
chmod 755 "$RUN_SH"

USER_SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_NAME="bytedesk-vault.service"
HAVE_SYSTEMD_USER=0
if need_cmd systemctl && systemctl --user show-environment >/dev/null 2>&1; then
  HAVE_SYSTEMD_USER=1
fi

if [[ "$HAVE_SYSTEMD_USER" -eq 1 ]]; then
  mkdir -p "$USER_SYSTEMD_DIR"
  cat >"$USER_SYSTEMD_DIR/$UNIT_NAME" <<EOF
[Unit]
Description=ByteDesk Vault (identity directory)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory=$VAULT_HOME
EnvironmentFile=-$STATE_FILE
Environment=VAULT_HOME=$VAULT_HOME
Environment=BYTEDESK_VAULT_HOME=$VAULT_HOME
ExecStart=$DEST_BIN -listen ${LISTEN_HOST}:${LISTEN_PORT} -data ${DATA_DIR} -org ${ORG_ID} -public-url ${PUBLIC_URL}
Restart=always
RestartSec=2
KillMode=process
TimeoutStopSec=8
LimitNOFILE=8192

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable "$UNIT_NAME" >/dev/null 2>&1 || true
  info "wrote user unit $USER_SYSTEMD_DIR/$UNIT_NAME"
else
  warn "systemctl --user not available; use $RUN_SH to start vault"
fi

# macOS launchd (optional)
HAVE_LAUNCHD=0
LAUNCHD_LABEL="ai.bytedesk.vault"
if [[ "$OS" == "darwin" ]] && need_cmd launchctl; then
  HAVE_LAUNCHD=1
  LAUNCH_AGENTS="${HOME}/Library/LaunchAgents"
  mkdir -p "$LAUNCH_AGENTS"
  PLIST="$LAUNCH_AGENTS/${LAUNCHD_LABEL}.plist"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${DEST_BIN}</string></array>
  <key>WorkingDirectory</key><string>${VAULT_HOME}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${VAULT_HOME}/vault.log</string>
  <key>StandardErrorPath</key><string>${VAULT_HOME}/vault.err.log</string>
</dict>
</plist>
EOF
  info "wrote launchd plist $PLIST"
fi

# Windows PowerShell companion
RUN_PS1="$VAULT_HOME/run.ps1"
cat >"$RUN_PS1" <<'PSEOF'
$ErrorActionPreference = "Stop"
$HomeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $HomeDir "control.env"
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      Set-Item -Path ("env:" + $matches[1]) -Value $matches[2]
    }
  }
}
if (-not $env:VAULT_HOME) { $env:VAULT_HOME = $HomeDir }
$bin = Join-Path $HomeDir "bin/bytedesk-vault.exe"
if (-not (Test-Path $bin)) { $bin = Join-Path $HomeDir "bin/bytedesk-vault" }
& $bin
PSEOF
info "wrote $RUN_PS1"


if [[ "${START_NOW:-0}" -eq 1 ]]; then
  if [[ "$HAVE_SYSTEMD_USER" -eq 1 ]]; then
    systemctl --user start bytedesk-vault.service || warn "failed to start vault unit"
  elif [[ "${HAVE_LAUNCHD:-0}" -eq 1 ]]; then
    launchctl unload "$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist" 2>/dev/null || true
    launchctl load "$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist" || warn "failed to load launchd"
  else
    nohup "$RUN_SH" >"$VAULT_HOME/vault.log" 2>&1 &
    echo $! >"$VAULT_HOME/vault.pid"
    info "started via run.sh pid=$(cat "$VAULT_HOME/vault.pid")"
  fi
fi

cat <<EOF

ByteDesk Vault installed (private-first identity directory).

  Home:     $VAULT_HOME
  Binary:   $DEST_BIN
  Data:     $DATA_DIR
  Bind:     ${LISTEN_HOST}:${LISTEN_PORT}
  Org:      $ORG_ID
  Public:   $PUBLIC_URL

Start:
EOF

if [[ "$HAVE_SYSTEMD_USER" -eq 1 ]]; then
  cat <<EOF
  systemctl --user start $UNIT_NAME
  systemctl --user status $UNIT_NAME
  journalctl --user -u $UNIT_NAME -f
EOF
else
  cat <<EOF
  $RUN_SH
  # or: nohup $RUN_SH >$VAULT_HOME/vault.log 2>&1 &
EOF
fi

cat <<EOF

Health (after start):
  curl -fsS http://${LISTEN_HOST}:${LISTEN_PORT}/healthz
  curl -fsS http://${LISTEN_HOST}:${LISTEN_PORT}/.well-known/jwks.json

Create an identity + enroll a gateway:
  curl -sS -X POST http://${LISTEN_HOST}:${LISTEN_PORT}/v1/identities \\
    -H 'Content-Type: application/json' \\
    -d '{"username":"ops","password":"choose-a-long-password"}'
  curl -sS -X POST http://${LISTEN_HOST}:${LISTEN_PORT}/v1/enroll/token \\
    -H 'Content-Type: application/json' \\
    -d '{"gatewayName":"my-gateway","ttlSeconds":600}'
  # redeem on the gateway host (writes GATEWAY_HOME/vault/enroll.json only)

Canonical product: https://github.com/ByteDeskAI/bytedesk-vault
See docs/adr/0012-bytedesk-vault.md and docs/adr/0013-multi-repo-product-topology.md.
EOF

exit 0
