#!/usr/bin/env bash
# ByteDesk gateway commercial installer — private-first free core.
# Platforms: Linux, macOS, Windows (Git Bash/MSYS/WSL + run.ps1).
#
# One-liner (when hosted):
#   curl -fsSL https://get.bytedesk.ai/gateway | sh
#   curl -fsSL https://get.bytedesk.ai/gateway | sh -s -- --profile core
#
# Offline / local artifact:
#   BYTEDESK_GATEWAY_ARTIFACT=./dist/bytedesk-gateway-linux-amd64 \
#     ./scripts/commercial/install.sh --home "$HOME/.bytedesk-gateway"
#
# Env:
#   BYTEDESK_GATEWAY_ARTIFACT     path to prebuilt binary (preferred offline)
#   BYTEDESK_GATEWAY_RELEASE_URL  HTTPS URL of binary to download
#   BYTEDESK_GATEWAY_RELEASE_BASE public origin for multi-arch bits
#                                 (default: https://get.bytedesk.ai/releases/latest)
#                                 get.bytedesk.ai proxies TeamCity release-publish artifacts.
#   BYTEDESK_GATEWAY_HOME         default home (also --home)
#   GATEWAY_HOME                  alias for home
set -euo pipefail

# BEGIN gateway containment unit contract v1 (synchronized standalone copy)
# Only install-time file generation. This does not activate or claim containment.
bdgw_containment_unit_contract() {
  local home="$1" unit="$2" version python helper helper_tmp quote_python quote_helper quote_home
  if [[ "$(uname -s)" != Linux ]] || ! command -v python3 >/dev/null 2>&1; then
    echo "containment prerequisites unavailable: Linux and python3 required; activation remains unverified" >&2
    return 0
  fi
  version="$(systemctl --version 2>/dev/null | head -n 1 | awk '{print $2}')"
  if [[ ! "$version" =~ ^[0-9]+$ ]] || [[ "$version" -lt 254 ]]; then
    echo "containment prerequisites unavailable: systemd 254+ required; activation remains unverified" >&2
    return 0
  fi
  python="$(command -v python3)"
  helper="$home/libexec/gateway-containment.py"
  mkdir -p "$home/libexec"
  if [[ -L "$home" || -L "$home/libexec" ]]; then
    echo "containment prerequisite: unsafe helper directory" >&2
    return 1
  fi
  helper_tmp="$(mktemp "$home/libexec/.gateway-containment.XXXXXX")"
  cat >"$helper_tmp" <<'BDGW_CONTAINMENT_PY'
#!/usr/bin/env python3
"""Gateway delegated subtree v1. Doctor is read-only; hooks run only in the unit."""
import contextlib
import json
import os
from pathlib import Path
import platform
import shutil
import stat
import subprocess
import sys
import time

PROFILE = 'linux-bwrap-cgv2-v1'
UNITS = ('bytedesk-gateway.service', 'bytedesk-emote-gateway.service')
CONTROLLERS = {'cpu', 'memory', 'pids'}
CGROOT = Path('/sys/fs/cgroup')


def read(path):
    return Path(path).read_text().strip()


def checked_dir(path):
    # Never follow a name collision into an unrelated subtree.
    path = Path(path)
    if path.is_symlink() or not path.is_dir() or path.resolve() != path:
        raise ValueError('unsafe-directory')
    return path


def unit_root(unit, membership):
    if unit not in UNITS:
        raise ValueError('user-service-required')
    parts = Path(membership).parts
    if '..' in parts or '.' in parts:
        raise ValueError('invalid-cgroup-path')
    prefix = '/user.slice/user-%d.slice/user@%d.service/' % (os.getuid(), os.getuid())
    if not membership.startswith(prefix) or not membership.endswith('/' + unit + '/.control'):
        raise ValueError('unit-control-process-required')
    return checked_dir(CGROOT / membership.lstrip('/')).parent


def own_membership():
    entries = [line[3:] for line in read('/proc/self/cgroup').splitlines() if line.startswith('0::')]
    if len(entries) != 1:
        raise ValueError('cgroup-v2-required')
    return entries[0]


def lease_path(home):
    home = checked_dir(Path(home).absolute())
    info = home.stat()
    if info.st_uid != os.getuid() or info.st_mode & 0o022:
        raise ValueError('unsafe-home-owner-mode')
    return home / 'plugin-cgroup-v1.json'


def identity(unit, root, plugins):
    return dict(version=1, profile=PROFILE, unit=unit,
                boot=read('/proc/sys/kernel/random/boot_id'),
                root=str(root), root_inode=root.stat().st_ino,
                plugins_inode=plugins.stat().st_ino, uid=os.getuid())


def load_lease(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('unsafe-lease')
        return json.load(stream)


def match_lease(path, unit, root, plugins):
    checked_dir(root)
    checked_dir(plugins)
    if load_lease(path) != identity(unit, root, plugins):
        raise ValueError('reserved-subtree-identity-mismatch')


def require_controllers(root):
    if not CONTROLLERS <= set(read(root / 'cgroup.controllers').split()):
        raise ValueError('controller-unavailable')
    if read(root / 'cgroup.procs'):
        raise ValueError('unit-root-has-processes')
    if read(root / 'cgroup.type') != 'domain':
        raise ValueError('domain-cgroup-required')


def prepare(unit, home):
    root = unit_root(unit, own_membership())
    require_controllers(root)
    path = lease_path(home)
    plugins = root / 'plugins'
    if plugins.exists() or plugins.is_symlink():
        match_lease(path, unit, root, plugins)
    else:
        plugins.mkdir()  # Exclusive reserved-name creation; never adopt a collision.
        try:
            value = identity(unit, root, plugins)
            # A private atomic receipt may replace a stale prior-boot receipt.
            tmp = path.with_name(path.name + '.new')
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as out:
                json.dump(value, out)
                out.flush()
                os.fsync(out.fileno())
            os.replace(tmp, path)
        except Exception:
            plugins.rmdir()
            raise
    require_controllers(root)
    (root / 'cgroup.subtree_control').write_text('+cpu +memory +pids')
    require_controllers(plugins)
    (plugins / 'cgroup.subtree_control').write_text('+cpu +memory +pids')
    for group in (root, plugins):
        if not CONTROLLERS <= set(read(group / 'cgroup.subtree_control').split()):
            raise ValueError('delegation-readback-failed')
    if not (plugins / 'cgroup.kill').is_file():
        raise ValueError('cgroup-kill-required')
    print('containment_subtree=prepared activation=unverified')


def open_directory(path):
    """Pin every path component without following symlinks."""
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('unsafe-directory')
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    fd = os.open('/', flags)
    try:
        for name in path.parts[1:]:
            child = os.open(name, flags, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_at(directory, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
    with os.fdopen(fd) as stream:
        return stream.read().strip()


def cleanup(unit, home):
    root = unit_root(unit, own_membership())
    with contextlib.ExitStack() as handles:
        root_fd = open_directory(root)
        handles.callback(os.close, root_fd)
        try:
            plugins_fd = os.open('plugins', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root_fd)
        except FileNotFoundError:
            print('containment_cleanup=absent')
            return
        handles.callback(os.close, plugins_fd)
        expected = dict(version=1, profile=PROFILE, unit=unit,
                        boot=read('/proc/sys/kernel/random/boot_id'), root=str(root),
                        root_inode=os.fstat(root_fd).st_ino,
                        plugins_inode=os.fstat(plugins_fd).st_ino, uid=os.getuid())
        if load_lease(lease_path(home)) != expected:
            raise ValueError('reserved-subtree-identity-mismatch')
        # Validation and the destructive open use the SAME pinned directory.
        # Renaming/replacing 'plugins' cannot redirect this write to a sibling.
        kill_fd = os.open('cgroup.kill', os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=plugins_fd)
        handles.callback(os.close, kill_fd)
        if os.write(kill_fd, b'1') != 1:
            raise ValueError('teardown-write-failed')
        deadline = time.monotonic() + 2
        while 'populated 0' not in read_at(plugins_fd, 'cgroup.events').splitlines():
            if time.monotonic() >= deadline:
                raise ValueError('teardown-timeout')
            time.sleep(0.02)
        named = os.stat('plugins', dir_fd=root_fd, follow_symlinks=False)
        pinned = os.fstat(plugins_fd)
        if (named.st_dev, named.st_ino) != (pinned.st_dev, pinned.st_ino):
            raise ValueError('reserved-subtree-identity-mismatch')
        # Linux has no inode-conditional rmdir/unlink. Retain the empty reserved
        # hierarchy and its receipt rather than racing name-based removal of a
        # successor. prepare() already accepts this exact owned empty subtree.
        print('containment_cleanup=empty-reserved-root-retained')


def command(args):
    try:
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                text=True, timeout=3, check=True)
        return result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ''


def doctor(home):
    print('containment_profile=' + PROFILE)
    print('containment_activation=unverified')
    if platform.system() != 'Linux':
        print('containment_prerequisite=unsupported-platform')
        return
    unified = (CGROOT / 'cgroup.controllers').is_file()
    print('containment_cgroup_v2=' + ('present' if unified else 'missing'))
    version = command(['systemctl', '--version']).split()
    print('containment_systemd_version=' + (version[1] if len(version) > 1 and version[1].isdecimal() else 'unavailable'))
    selected = None
    properties = {}
    for unit in UNITS:
        raw = command(['systemctl', '--user', 'show', unit, '--no-pager',
                       '--property=Id,LoadState,ActiveState,ControlGroup,Delegate,DelegateControllers,DelegateSubgroup,MainPID'])
        props = dict(line.split('=', 1) for line in raw.splitlines() if '=' in line)
        if props.get('Id') == unit and props.get('ActiveState') == 'active':
            selected, properties = unit, props
            break
    print('containment_user_unit=' + (selected or 'unavailable'))
    delegation = properties.get('Delegate') == 'yes' and CONTROLLERS <= set(properties.get('DelegateControllers', '').split())
    print('containment_delegation=' + ('configured' if delegation else 'unavailable'))
    print('containment_delegate_subgroup=' + ('host' if properties.get('DelegateSubgroup') == 'host' else 'unavailable'))
    health = 'unavailable'
    controllers = 'unavailable'
    kill = 'unavailable'
    kernel_kill = 'unverified'
    main_identity = 'unverified'
    subtree_reason = 'user-service-required'
    if selected and unified:
        try:
            cg = properties.get('ControlGroup', '')
            prefix = '/user.slice/user-%d.slice/user@%d.service/' % (os.getuid(), os.getuid())
            if not cg.startswith(prefix) or not cg.endswith('/' + selected) or '..' in Path(cg).parts:
                raise ValueError('unit-identity-mismatch')
            root = checked_dir(CGROOT / cg.lstrip('/'))
            kernel_kill = 'present-at-unit' if (root / 'cgroup.kill').is_file() else 'missing-at-unit'
            require_controllers(root)
            controllers = 'available' if CONTROLLERS <= set(read(root / 'cgroup.subtree_control').split()) and os.access(root / 'cgroup.subtree_control', os.W_OK) else 'not-enabled-or-writable'
            pid = int(properties.get('MainPID', '0'))
            if pid > 0 and '0::' + cg + '/host' in read('/proc/%d/cgroup' % pid).splitlines():
                main_identity = 'host-subgroup-matched'
            plugins = root / 'plugins'
            kill = 'present' if (plugins / 'cgroup.kill').is_file() else 'missing'
            if not plugins.exists():
                health = 'absent'
            else:
                match_lease(lease_path(home), selected, root, plugins)
                controls = CONTROLLERS <= set(read(plugins / 'cgroup.subtree_control').split())
                health = 'owned-empty' if 'populated 0' in read(plugins / 'cgroup.events').splitlines() else 'owned-populated-runtime-review-required'
                if not controls:
                    health = 'owned-controllers-unavailable'
        except (OSError, ValueError, KeyError) as exc:
            health = 'unverified-or-mismatched'
            subtree_reason = str(exc) if isinstance(exc, ValueError) and str(exc) in {'unit-root-has-processes', 'controller-unavailable', 'domain-cgroup-required', 'unsafe-directory', 'unsafe-lease', 'unsafe-home-owner-mode', 'reserved-subtree-identity-mismatch'} else 'ownership-or-delegation-unverified'
        else:
            subtree_reason = 'read-only-check-complete'
    print('containment_main_identity=' + main_identity)
    print('containment_controllers=' + controllers)
    print('containment_cgroup_kill=' + kill)
    print('containment_cgroup_kill_kernel=' + kernel_kill)
    print('containment_reserved_subtree=' + health)
    print('containment_subtree_reason=' + subtree_reason)
    help_text = command(['bwrap', '--help']) if shutil.which('bwrap') else ''
    flags = ('--unshare-user', '--unshare-pid', '--unshare-cgroup', '--unshare-net', '--info-fd')
    print('containment_bubblewrap=' + ('flags-present-execution-unverified' if all(f in help_text for f in flags) else 'missing-or-incompatible'))
    for namespace in ('user', 'mnt', 'pid'):
        print('containment_namespace_' + namespace + '=' + ('present-execution-unverified' if Path('/proc/self/ns/' + namespace).exists() else 'missing'))
    for key, file in [('userns_limit', '/proc/sys/user/max_user_namespaces'),
                      ('unprivileged_userns', '/proc/sys/kernel/unprivileged_userns_clone'),
                      ('apparmor_userns', '/proc/sys/kernel/apparmor_restrict_unprivileged_userns')]:
        try:
            value = read(file)
            value = value if value.isdecimal() else 'unverified'
        except OSError:
            value = 'unavailable'
        print('containment_' + key + '=' + value)
    pidfd = 'unavailable'
    if hasattr(os, 'pidfd_open'):
        try:
            fd = os.pidfd_open(os.getpid())
            os.close(fd)
            pidfd = 'self-open-verified'
        except OSError:
            pass
    print('containment_pidfd=' + pidfd)
    print('containment_sandbox_execution=not-probed-read-only')


def main():
    if len(sys.argv) == 3 and sys.argv[1] == 'doctor':
        doctor(sys.argv[2])
    elif len(sys.argv) == 4 and sys.argv[1] in ('prepare', 'cleanup'):
        if platform.system() != 'Linux':
            raise ValueError('unsupported-platform')
        if not (CGROOT / 'cgroup.controllers').is_file():
            raise ValueError('cgroup-v2-required')
        (prepare if sys.argv[1] == 'prepare' else cleanup)(sys.argv[2], sys.argv[3])
    else:
        raise ValueError('invalid-operation')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Never print environment values, paths, exception text or process payload.
        reason = str(exc) if isinstance(exc, ValueError) and str(exc) in {
            'user-service-required', 'unit-control-process-required', 'controller-unavailable',
            'unit-root-has-processes', 'domain-cgroup-required', 'delegation-readback-failed',
            'cgroup-kill-required', 'teardown-timeout', 'unsupported-platform', 'cgroup-v2-required',
            'reserved-subtree-identity-mismatch', 'unsafe-lease', 'unsafe-home-owner-mode',
            'unsafe-directory'} else 'prerequisite-or-ownership-unverified'
        print('containment_prerequisite=' + reason, file=sys.stderr)
        sys.exit(1)
BDGW_CONTAINMENT_PY
  chmod 700 "$helper_tmp"
  mv -f "$helper_tmp" "$helper"
  # systemd command quoting, not shell quoting; block line injection and expand
  # neither dollar variables nor percent specifiers from an installation path.
  quote_python="${python//\\/\\\\}"; quote_python="${quote_python//\"/\\\"}"
  quote_helper="${helper//\\/\\\\}"; quote_helper="${quote_helper//\"/\\\"}"
  quote_home="${home//\\/\\\\}"; quote_home="${quote_home//\"/\\\"}"
  quote_python="${quote_python//%/%%}"; quote_python="${quote_python//\$/\$\$}"
  quote_helper="${quote_helper//%/%%}"; quote_helper="${quote_helper//\$/\$\$}"
  quote_home="${quote_home//%/%%}"; quote_home="${quote_home//\$/\$\$}"
  if [[ "$home$python" == *$'\n'* || "$home$python" == *$'\r'* ]]; then
    echo "containment prerequisite: unsupported installation path" >&2
    return 1
  fi
  printf '%s\n' 'Delegate=cpu memory pids' 'DelegateSubgroup=host'
  # A missing prerequisite must not stop the free-core gateway. The runtime
  # independently requires verified delegation/limits/receipt before activation.
  printf 'ExecStartPre=-"%s" "%s" prepare %s "%s"\n' "$quote_python" "$quote_helper" "$unit" "$quote_home"
  printf 'ExecStopPost="%s" "%s" cleanup %s "%s"\n' "$quote_python" "$quote_helper" "$unit" "$quote_home"
  echo "containment unit contract generated; delegation and sandbox activation remain unverified" >&2
  "$python" "$helper" doctor "$home" >&2 || true
}
# END gateway containment unit contract v1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# When piped via curl|sh, BASH_SOURCE may be empty or /dev/fd — treat as remote.
# Walk up from this skill script to find a monorepo checkout (optional offline dist/).
REPO_ROOT=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  _walk="$SCRIPT_DIR"
  for _ in 1 2 3 4 5 6 7 8; do
    if [[ -f "$_walk/src/main.go" ]]; then
      REPO_ROOT="$_walk"
      break
    fi
    _parent="$(cd "$_walk/.." 2>/dev/null && pwd)" || break
    [[ "$_parent" == "$_walk" ]] && break
    _walk="$_parent"
  done
fi

PROFILE="core"
GATEWAY_HOME_DEFAULT="${BYTEDESK_GATEWAY_HOME:-${GATEWAY_HOME:-${HOME}/.bytedesk-gateway}}"
GATEWAY_HOME="$GATEWAY_HOME_DEFAULT"
BIND_DEFAULT="127.0.0.1:18443"
BIND="$BIND_DEFAULT"
START_NOW=0

die() { echo "install: error: $*" >&2; exit 1; }
warn() { echo "install: warning: $*" >&2; }
info() { echo "install: $*"; }

usage() {
  cat <<'EOF'
Usage: install.sh [options]

  --home DIR       Product home (default: $HOME/.bytedesk-gateway)
  --bind HOST:PORT Private listen address (default: 127.0.0.1:18443)
  --profile NAME   Dependency profile: core | agents | desktop (default: core)
  --start          Start the gateway after install (systemd --user or run.sh)
  -h, --help       Show this help

Does NOT require Tailscale, Funnel, Cloudflare Tunnel, or a monorepo checkout.

Artifact resolution order:
  1. BYTEDESK_GATEWAY_ARTIFACT (local path)
  2. BYTEDESK_GATEWAY_RELEASE_URL (download)
  3. BYTEDESK_GATEWAY_RELEASE_BASE / bytedesk-gateway-\$OS-\$ARCH
     (default https://get.bytedesk.ai/releases/latest — TeamCity via proxy)
  4. GitHub Releases latest asset
     (https://github.com/ByteDeskAI/bytedesk-remote-gateway/releases/latest)
  5. Local dist/ next to this script or repo root (offline)

Release notes for each published version live on the GitHub Release page.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --home)
      [[ $# -ge 2 ]] || die "--home requires a directory"
      GATEWAY_HOME="$2"
      shift 2
      ;;
    --bind)
      [[ $# -ge 2 ]] || die "--bind requires HOST:PORT"
      BIND="$2"
      shift 2
      ;;
    --profile)
      [[ $# -ge 2 ]] || die "--profile requires a name"
      PROFILE="$2"
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

case "$PROFILE" in
  core|agents|desktop) ;;
  *) die "unknown profile '$PROFILE' (use core|agents|desktop)" ;;
esac

# Parse bind
if [[ "$BIND" != *:* ]]; then
  die "--bind must be HOST:PORT (got: $BIND)"
fi
LISTEN_HOST="${BIND%:*}"
LISTEN_PORT="${BIND##*:}"
[[ -n "$LISTEN_HOST" && -n "$LISTEN_PORT" ]] || die "invalid --bind: $BIND"
[[ "$LISTEN_PORT" =~ ^[0-9]+$ ]] || die "invalid port in --bind: $BIND"

# shellcheck source=lib/platform.sh
SCRIPT_DIR_FOR_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR_FOR_LIB/lib/platform.sh"

detect_arch() { bdgw_detect_arch; }
detect_os() { bdgw_detect_os; }

OS="$(detect_os)"
ARCH="$(detect_arch)"
ARTIFACT_EXT=""
[[ "$OS" == "windows" ]] && ARTIFACT_EXT=".exe"
ARTIFACT_NAME="bytedesk-gateway-${OS}-${ARCH}${ARTIFACT_EXT}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

RELEASE_BASE="${BYTEDESK_GATEWAY_RELEASE_BASE:-https://get.bytedesk.ai/releases/latest}"
# Strip trailing slash for stable joins.
RELEASE_BASE="${RELEASE_BASE%/}"

try_download() {
  local url="$1" out="$2"
  need_cmd curl || return 1
  curl -fsSL --connect-timeout 15 --max-time 300 "$url" -o "$out"
}

# Download a release asset from GitHub. Supports private repos when gh is logged
# in or GITHUB_TOKEN / GH_TOKEN is set. Falls back to anonymous browser URL
# (works only for public repos).
try_github_release_download() {
  local repo="$1" name="$2" out="$3"
  local tag="${BYTEDESK_GATEWAY_RELEASE_TAG:-latest}"

  if need_cmd gh; then
    info "trying GitHub release via gh: $repo@$tag / $name"
    local gh_dir
    gh_dir="$(mktemp -d)"
    if [[ "$tag" == "latest" ]]; then
      gh release download --repo "$repo" -p "$name" -D "$gh_dir" --clobber >/dev/null 2>&1 || true
    else
      gh release download "$tag" --repo "$repo" -p "$name" -D "$gh_dir" --clobber >/dev/null 2>&1 || true
    fi
    if [[ -s "$gh_dir/$name" ]]; then
      mv -f "$gh_dir/$name" "$out"
      rm -rf "$gh_dir"
      return 0
    fi
    rm -rf "$gh_dir"
  fi

  local token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  if [[ -n "$token" ]] && need_cmd curl; then
    info "trying GitHub release via API token: $repo@$tag / $name"
    local api_tag_path release_json asset_api
    if [[ "$tag" == "latest" ]]; then
      api_tag_path="https://api.github.com/repos/${repo}/releases/latest"
    else
      api_tag_path="https://api.github.com/repos/${repo}/releases/tags/${tag}"
    fi
    release_json="$(curl -fsSL --connect-timeout 15 --max-time 60 \
      -H "Authorization: Bearer ${token}" \
      -H "Accept: application/vnd.github+json" \
      "$api_tag_path" 2>/dev/null)" || return 1
    asset_api="$(printf '%s' "$release_json" | python3 -c '
import json,sys
name=sys.argv[1]
data=json.load(sys.stdin)
for a in data.get("assets") or []:
    if a.get("name")==name:
        print(a.get("url") or "")
        break
' "$name" 2>/dev/null)" || return 1
    [[ -n "$asset_api" ]] || return 1
    if curl -fsSL --connect-timeout 15 --max-time 300 \
      -H "Authorization: Bearer ${token}" \
      -H "Accept: application/octet-stream" \
      -o "$out" "$asset_api" && [[ -s "$out" ]]; then
      return 0
    fi
  fi

  local gh_url
  if [[ "$tag" == "latest" ]]; then
    gh_url="https://github.com/${repo}/releases/latest/download/${name}"
  else
    gh_url="https://github.com/${repo}/releases/download/${tag}/${name}"
  fi
  info "trying GitHub release download: $gh_url"
  try_download "$gh_url" "$out" && [[ -s "$out" ]]
}

resolve_artifact() {
  if [[ -n "${BYTEDESK_GATEWAY_ARTIFACT:-}" ]]; then
    [[ -f "$BYTEDESK_GATEWAY_ARTIFACT" ]] || die "BYTEDESK_GATEWAY_ARTIFACT not found: $BYTEDESK_GATEWAY_ARTIFACT"
    printf '%s\n' "$BYTEDESK_GATEWAY_ARTIFACT"
    return 0
  fi

  if [[ -n "${BYTEDESK_GATEWAY_RELEASE_URL:-}" ]]; then
    need_cmd curl || die "curl required to download BYTEDESK_GATEWAY_RELEASE_URL"
    local tmp
    tmp="$(mktemp)"
    info "downloading $BYTEDESK_GATEWAY_RELEASE_URL"
    curl -fsSL "$BYTEDESK_GATEWAY_RELEASE_URL" -o "$tmp" || die "download failed"
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

  # GitHub Releases (published by .github/workflows/release-core.yml on v* tags).
  # Repo may be private: prefer authenticated gh CLI / API token over anonymous URLs.
  local gh_repo="${BYTEDESK_GATEWAY_GITHUB_REPO:-ByteDeskAI/bytedesk-remote-gateway}"
  local tmp_gh
  tmp_gh="$(mktemp)"
  if try_github_release_download "$gh_repo" "$ARTIFACT_NAME" "$tmp_gh"; then
    printf '%s\n' "$tmp_gh"
    return 0
  fi
  rm -f "$tmp_gh" 2>/dev/null || true

  # Offline: dist relative to script / repo
  local candidates=(
    "${REPO_ROOT}/dist/${ARTIFACT_NAME}"
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

  die "no gateway binary found.
  Set BYTEDESK_GATEWAY_ARTIFACT=/path/to/${ARTIFACT_NAME}
  or BYTEDESK_GATEWAY_RELEASE_URL=https://...
  or ensure ${RELEASE_BASE}/${ARTIFACT_NAME} is published
  or publish a GitHub Release with ${ARTIFACT_NAME}
    (https://github.com/${gh_repo}/releases/latest)
  or place a local release under dist/${ARTIFACT_NAME}
  (build with: ./scripts/commercial/release-core.sh)"
}

SRC_ARTIFACT="$(resolve_artifact)"
[[ -f "$SRC_ARTIFACT" ]] || die "artifact missing: $SRC_ARTIFACT"
[[ -s "$SRC_ARTIFACT" ]] || die "artifact is empty: $SRC_ARTIFACT"

info "profile=$PROFILE home=$GATEWAY_HOME bind=$BIND"
info "artifact=$SRC_ARTIFACT"

mkdir -p "$GATEWAY_HOME" "$GATEWAY_HOME/plugins" "$GATEWAY_HOME/bin"
chmod 700 "$GATEWAY_HOME"

DEST_BIN="$GATEWAY_HOME/bin/bytedesk-gateway"
[[ "$OS" == "windows" ]] && DEST_BIN="${DEST_BIN}.exe"
# Portable copy (macOS/Git Bash may lack GNU install)
bdgw_install_bin() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  cp -f "$src" "$dest"
  chmod 755 "$dest" 2>/dev/null || chmod u+x "$dest" || true
}
bdgw_install_bin "$SRC_ARTIFACT" "$DEST_BIN"
# Clean temp download if we used mktemp under /tmp
if [[ "$SRC_ARTIFACT" == /tmp/* || "$SRC_ARTIFACT" == "${TMPDIR:-/tmp}"/* ]]; then
  rm -f "$SRC_ARTIFACT" 2>/dev/null || true
fi

[[ -x "$DEST_BIN" ]] || die "installed binary is not executable: $DEST_BIN"

# control.env template — private bind; do not clobber existing secrets
STATE_FILE="$GATEWAY_HOME/control.env"
if [[ ! -f "$STATE_FILE" ]]; then
  SESSION_SECRET="$(openssl rand -base64 48 2>/dev/null || head -c 48 /dev/urandom | base64)"
  SETUP_TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p | tr -d '\n' | head -c 48)"
  ADMIN_TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p | tr -d '\n' | head -c 48)"
  cat >"$STATE_FILE" <<EOF
# ByteDesk gateway control.env (private-first commercial core)
# Generated by scripts/commercial/install.sh — do not commit.

SESSION_SECRET=${SESSION_SECRET}
SETUP_TOKEN=${SETUP_TOKEN}
ADMIN_TOKEN=${ADMIN_TOKEN}

LISTEN_HOST=${LISTEN_HOST}
LISTEN_PORT=${LISTEN_PORT}
GATEWAY_HOME=${GATEWAY_HOME}
BYTEDESK_EMOTE_GATEWAY_HOME=${GATEWAY_HOME}
CONFIG_PATH=${GATEWAY_HOME}/config.json
SESSION_STORE_PATH=${GATEWAY_HOME}/sessions.json

# Private mode: no Tailscale/Funnel/tunnel required.
# AUTH_MODE=local  (set after /setup creates config.json)
# REQUIRE_APPROVAL=false
EOF
  chmod 600 "$STATE_FILE"
  info "wrote $STATE_FILE"
else
  info "preserving existing $STATE_FILE"
  # Ensure listen settings exist without overwriting secrets
  grep -q '^LISTEN_HOST=' "$STATE_FILE" || printf 'LISTEN_HOST=%s\n' "$LISTEN_HOST" >>"$STATE_FILE"
  grep -q '^LISTEN_PORT=' "$STATE_FILE" || printf 'LISTEN_PORT=%s\n' "$LISTEN_PORT" >>"$STATE_FILE"
  grep -q '^GATEWAY_HOME=' "$STATE_FILE" || printf 'GATEWAY_HOME=%s\n' "$GATEWAY_HOME" >>"$STATE_FILE"
  grep -q '^BYTEDESK_EMOTE_GATEWAY_HOME=' "$STATE_FILE" || printf 'BYTEDESK_EMOTE_GATEWAY_HOME=%s\n' "$GATEWAY_HOME" >>"$STATE_FILE"
  grep -q '^CONFIG_PATH=' "$STATE_FILE" || printf 'CONFIG_PATH=%s\n' "$GATEWAY_HOME/config.json" >>"$STATE_FILE"
  chmod 600 "$STATE_FILE"
fi

# shellcheck disable=SC1090
source "$STATE_FILE"
: "${SETUP_TOKEN:?SETUP_TOKEN missing from control.env}"

# Seed signed Store fixtures (free example + paid-demo) so offline catalog install works
# without BYTEDESK_GATEWAY_ALLOW_UNSIGNED. Uses the real gateway store-seed-fixtures CLI.
if [[ -x "$DEST_BIN" ]]; then
  if GATEWAY_HOME="$GATEWAY_HOME" BYTEDESK_GATEWAY_HOME="$GATEWAY_HOME" \
    "$DEST_BIN" store-seed-fixtures >/dev/null 2>&1; then
    info "seeded Store fixtures under $GATEWAY_HOME/store-packages"
  else
    warn "could not seed store fixtures (will seed on first /api/store/catalog)"
  fi
fi

# run.sh always written — works without systemd
RUN_SH="$GATEWAY_HOME/run.sh"
cat >"$RUN_SH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
HOME_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
# shellcheck disable=SC1091
set -a
source "\$HOME_DIR/control.env"
set +a
export GATEWAY_HOME="\${GATEWAY_HOME:-\$HOME_DIR}"
export BYTEDESK_EMOTE_GATEWAY_HOME="\${BYTEDESK_EMOTE_GATEWAY_HOME:-\$GATEWAY_HOME}"
export CONFIG_PATH="\${CONFIG_PATH:-\$GATEWAY_HOME/config.json}"
export SESSION_STORE_PATH="\${SESSION_STORE_PATH:-\$GATEWAY_HOME/sessions.json}"
export LISTEN_HOST="\${LISTEN_HOST:-127.0.0.1}"
export LISTEN_PORT="\${LISTEN_PORT:-18443}"
export SESSION_SECRET SETUP_TOKEN ADMIN_TOKEN
exec "\$HOME_DIR/bin/bytedesk-gateway"
EOF
chmod 755 "$RUN_SH"

# Service integration: systemd (Linux), launchd (macOS), none (Windows / fallback → run.sh)
UNIT_NAME="bytedesk-gateway.service"
LAUNCHD_LABEL="ai.bytedesk.gateway"
HAVE_SYSTEMD_USER=0
HAVE_LAUNCHD=0
if need_cmd systemctl && systemctl --user show-environment >/dev/null 2>&1; then
  HAVE_SYSTEMD_USER=1
fi
if [[ "$OS" == "darwin" ]] && need_cmd launchctl; then
  HAVE_LAUNCHD=1
fi

if [[ "$HAVE_SYSTEMD_USER" -eq 1 ]]; then
  USER_SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  mkdir -p "$USER_SYSTEMD_DIR"
  containment_unit_contract="$(bdgw_containment_unit_contract "$GATEWAY_HOME" "$UNIT_NAME")"
  cat >"$USER_SYSTEMD_DIR/$UNIT_NAME" <<EOF
[Unit]
Description=ByteDesk gateway (private free core)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
WorkingDirectory=$GATEWAY_HOME
EnvironmentFile=-$STATE_FILE
Environment=GATEWAY_HOME=$GATEWAY_HOME
Environment=BYTEDESK_EMOTE_GATEWAY_HOME=$GATEWAY_HOME
Environment=CONFIG_PATH=$GATEWAY_HOME/config.json
Environment=SESSION_STORE_PATH=$GATEWAY_HOME/sessions.json
Environment=LISTEN_HOST=$LISTEN_HOST
Environment=LISTEN_PORT=$LISTEN_PORT
ExecStart=$DEST_BIN
$containment_unit_contract
Restart=always
RestartSec=2
KillMode=process
TimeoutStopSec=8
LimitNOFILE=16384
MemoryMax=4G
TasksMax=512

[Install]
WantedBy=default.target
EOF
  MCP_UNIT_NAME="bytedesk-gateway-mcp.service"
  cat >"$USER_SYSTEMD_DIR/$MCP_UNIT_NAME" <<EOF
[Unit]
Description=ByteDesk gateway operator MCP sidecar
After=network-online.target
Wants=network-online.target
# Independent of main unit so MCP still works if the gateway process is down.

[Service]
Type=simple
WorkingDirectory=$GATEWAY_HOME
EnvironmentFile=-$STATE_FILE
Environment=GATEWAY_HOME=$GATEWAY_HOME
Environment=BYTEDESK_EMOTE_GATEWAY_HOME=$GATEWAY_HOME
Environment=GATEWAY_MCP_HTTP=1
Environment=GATEWAY_MCP_LISTEN=127.0.0.1:8757
ExecStart=$DEST_BIN mcp-gateway --http
Restart=always
RestartSec=2
KillMode=process

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable "$UNIT_NAME" >/dev/null 2>&1 || true
  systemctl --user enable "$MCP_UNIT_NAME" >/dev/null 2>&1 || true
  info "wrote user unit $USER_SYSTEMD_DIR/$UNIT_NAME"
  info "wrote user unit $USER_SYSTEMD_DIR/$MCP_UNIT_NAME"
elif [[ "$HAVE_LAUNCHD" -eq 1 ]]; then
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
  <array>
    <string>${DEST_BIN}</string>
  </array>
  <key>WorkingDirectory</key><string>${GATEWAY_HOME}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>GATEWAY_HOME</key><string>${GATEWAY_HOME}</string>
    <key>BYTEDESK_EMOTE_GATEWAY_HOME</key><string>${GATEWAY_HOME}</string>
    <key>CONFIG_PATH</key><string>${GATEWAY_HOME}/config.json</string>
    <key>SESSION_STORE_PATH</key><string>${GATEWAY_HOME}/sessions.json</string>
    <key>LISTEN_HOST</key><string>${LISTEN_HOST}</string>
    <key>LISTEN_PORT</key><string>${LISTEN_PORT}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${GATEWAY_HOME}/gateway.log</string>
  <key>StandardErrorPath</key><string>${GATEWAY_HOME}/gateway.err.log</string>
</dict>
</plist>
EOF
  info "wrote launchd plist $PLIST (load with: launchctl load $PLIST)"
else
  warn "no user service manager; use $RUN_SH (or run.ps1 on Windows) to start the gateway"
fi

# Windows-friendly companion launcher
RUN_PS1="$GATEWAY_HOME/run.ps1"
cat >"$RUN_PS1" <<'PSEOF'
# ByteDesk gateway launcher (Windows PowerShell / pwsh)
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
if (-not $env:GATEWAY_HOME) { $env:GATEWAY_HOME = $HomeDir }
$env:BYTEDESK_EMOTE_GATEWAY_HOME = $env:GATEWAY_HOME
$bin = Join-Path $HomeDir "bin/bytedesk-gateway.exe"
if (-not (Test-Path $bin)) { $bin = Join-Path $HomeDir "bin/bytedesk-gateway" }
& $bin
PSEOF
info "wrote $RUN_PS1"

# Profile dependency checks (non-fatal for core binary install; doctor-style)
check_dep() {
  local name="$1" required="$2"
  if need_cmd "$name"; then
    info "dep ok: $name"
    return 0
  fi
  if [[ "$required" == "required" ]]; then
    warn "missing REQUIRED for profile=$PROFILE: $name"
    return 1
  fi
  warn "missing optional ($PROFILE): $name"
  return 0
}

MISSING=0
case "$PROFILE" in
  core)
    # Core binary already installed. ttyd/tmux optional for terminal tabs.
    check_dep openssl optional || true
    if ! need_cmd ttyd; then
      warn "ttyd not on PATH — terminal tabs need ttyd (optional for bare core health/API)"
    fi
    if ! need_cmd tmux; then
      warn "tmux not on PATH — multi-session terminals need tmux (optional for bare core)"
    fi
    ;;
  agents)
    check_dep ttyd optional || true
    check_dep tmux optional || true
    for c in claude codex grok; do
      need_cmd "$c" || warn "agent CLI not found: $c (install when you need that launcher)"
    done
    ;;
  desktop)
    check_dep ttyd optional || true
    check_dep tmux optional || true
    case "$OS" in
      linux)
        for c in firefox Xvfb x11vnc; do
          need_cmd "$c" || warn "desktop dep not found: $c"
        done
        ;;
      darwin)
        for c in firefox; do
          need_cmd "$c" || warn "desktop dep not found: $c (macOS virtual desktop is limited; prefer core profile or install XQuartz tooling)"
        done
        warn "desktop profile on macOS is best-effort (no Xvfb/x11vnc by default)"
        ;;
      windows)
        warn "desktop profile on Windows is best-effort (VNC stack not bundled); use core profile + remote desktop separately"
        ;;
    esac
    ;;
esac

SETUP_URL="http://${LISTEN_HOST}:${LISTEN_PORT}/setup?token=${SETUP_TOKEN}"

if [[ "${START_NOW:-0}" -eq 1 ]]; then
  if [[ "$HAVE_SYSTEMD_USER" -eq 1 ]]; then
    systemctl --user start "$UNIT_NAME" || warn "failed to start $UNIT_NAME"
  elif [[ "${HAVE_LAUNCHD:-0}" -eq 1 ]]; then
    launchctl unload "$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist" 2>/dev/null || true
    launchctl load "$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist" || warn "failed to load launchd plist"
    info "started via launchd $LAUNCHD_LABEL"
  else
    nohup "$RUN_SH" >"$GATEWAY_HOME/gateway.log" 2>&1 &
    echo $! >"$GATEWAY_HOME/gateway.pid"
    info "started via run.sh pid=$(cat "$GATEWAY_HOME/gateway.pid")"
  fi
fi

cat <<EOF

ByteDesk gateway installed (private-first).

  Home:     $GATEWAY_HOME
  Binary:   $DEST_BIN
  Bind:     ${LISTEN_HOST}:${LISTEN_PORT}
  Profile:  $PROFILE
  Plugins:  $GATEWAY_HOME/plugins/

First-run setup (create local MFA operator):
  $SETUP_URL

Start:
EOF

if [[ "$HAVE_SYSTEMD_USER" -eq 1 ]]; then
  cat <<EOF
  systemctl --user start $UNIT_NAME
  systemctl --user status $UNIT_NAME
  journalctl --user -u $UNIT_NAME -f
EOF
elif [[ "$HAVE_LAUNCHD" -eq 1 ]]; then
  cat <<EOF
  launchctl load ~/Library/LaunchAgents/${LAUNCHD_LABEL}.plist
  # stop: launchctl unload ~/Library/LaunchAgents/${LAUNCHD_LABEL}.plist
  # or: $RUN_SH
EOF
else
  cat <<EOF
  $RUN_SH
  # Windows PowerShell: pwsh $RUN_PS1
  # or: nohup $RUN_SH >$GATEWAY_HOME/gateway.log 2>&1 &
EOF
fi

cat <<EOF

Health (after start):
  curl -fsS http://${LISTEN_HOST}:${LISTEN_PORT}/healthz

Doctor / plugins:
  bdgw doctor
  bdgw plugin list

No Tailscale, Funnel, or public tunnel is required for private mode.
See docs/install.md and docs/commercial/CORE_DEPS.md.
EOF

exit 0
