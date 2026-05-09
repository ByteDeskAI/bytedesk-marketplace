#!/usr/bin/env bash
# install.sh — wire the vendored claude-sessions tooling into the user's environment.
#
# What it does (idempotent — safe to re-run):
#   1. Symlinks `claude-sessions` and `spawn-claude-feature` into ~/.local/bin/.
#      Existing regular files are backed up to *.bak first; existing correct
#      symlinks are left alone.
#   2. Copies the two systemd unit files into ~/.config/systemd/user/.
#      (Copies, not symlinks, so systemd's own state management stays sane.)
#   3. Runs `systemctl --user daemon-reload` and restarts the two services.
#
# Pre-req: ~/.local/bin must already be on $PATH (standard XDG layout).

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
BIN_DIR="${HOME}/.local/bin"
UNIT_DIR="${HOME}/.config/systemd/user"

mkdir -p "${BIN_DIR}" "${UNIT_DIR}"

link_script() {
  local name="$1"
  local src="${SCRIPT_DIR}/${name}"
  local dst="${BIN_DIR}/${name}"

  if [[ ! -f "${src}" ]]; then
    echo "  ! missing source: ${src}" >&2
    return 1
  fi
  chmod +x "${src}"

  if [[ -L "${dst}" ]]; then
    local current
    current="$(readlink -f "${dst}")"
    if [[ "${current}" == "${src}" ]]; then
      echo "  = ${dst} → already correct"
      return 0
    fi
    echo "  ~ ${dst} → relinking (was ${current})"
    rm -f "${dst}"
  elif [[ -e "${dst}" ]]; then
    echo "  ~ ${dst} → backing up existing file to ${dst}.bak"
    mv "${dst}" "${dst}.bak"
  fi

  ln -s "${src}" "${dst}"
  echo "  + ${dst} → ${src}"
}

copy_unit() {
  local name="$1"
  local src="${SCRIPT_DIR}/systemd/${name}"
  local dst="${UNIT_DIR}/${name}"

  if [[ ! -f "${src}" ]]; then
    echo "  ! missing source: ${src}" >&2
    return 1
  fi

  if [[ -f "${dst}" ]] && cmp -s "${src}" "${dst}"; then
    echo "  = ${dst} → already correct"
    return 0
  fi

  install -m 0644 "${src}" "${dst}"
  echo "  + ${dst}"
}

echo "Installing claude-sessions tooling…"
echo ""
echo "Scripts → ${BIN_DIR}:"
link_script claude-sessions
link_script spawn-claude-feature

echo ""
echo "Systemd units → ${UNIT_DIR}:"
copy_unit claude-sessions-web.service
copy_unit claude-sessions-notify.service

echo ""
echo "Reloading systemd and (re)starting services…"
systemctl --user daemon-reload
systemctl --user enable --now claude-sessions-web.service claude-sessions-notify.service >/dev/null
systemctl --user restart claude-sessions-web.service claude-sessions-notify.service

echo ""
if [[ "${SCRIPT_DIR}" == */.claude/worktrees/* ]]; then
  echo "⚠  Installed from a git worktree:"
  echo "     ${SCRIPT_DIR}"
  echo "   The symlinks point at the worktree path. After this branch merges"
  echo "   and the worktree is removed, re-run install.sh from the main"
  echo "   checkout so the symlinks resolve to a stable location."
  echo ""
fi
echo "Done. Verify with:"
echo "  claude-sessions"
echo "  systemctl --user status claude-sessions-web claude-sessions-notify"
echo "  open http://127.0.0.1:7681/"
