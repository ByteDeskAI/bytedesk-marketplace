---
name: gateway-install
description: >
  Install ByteDesk remote gateway (commercial free core) on Linux, macOS, or
  Windows. Profiles core|agents|desktop. Use when the user says install gateway,
  setup gateway, or wants a private-first bytedesk-gateway home.
---

# gateway-install

## Resolve scripts

```bash
ROOT="${GROK_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
SKILL_DIR="${ROOT:+$ROOT/skills/gateway-install}"
SKILL_DIR="${SKILL_DIR:-<directory containing this SKILL.md>}"
# Linux/macOS/Git Bash:
"$SKILL_DIR/scripts/install.sh" --profile desktop --start
# Windows PowerShell:
# pwsh -File "$SKILL_DIR/scripts/install.ps1" --profile core --start
```

## Platforms

| OS | Service integration | Notes |
|----|---------------------|-------|
| Linux | systemd --user when available | else `run.sh` |
| macOS | launchd LaunchAgent | else `run.sh` |
| Windows | `run.ps1` / pid file | needs bash (Git Bash/WSL) for install.sh; `.exe` artifact when published |

If the public release has no darwin/windows triple yet, set:

```bash
export BYTEDESK_GATEWAY_ARTIFACT=/path/to/local-binary
```

## Options

```bash
"$SKILL_DIR/scripts/install.sh" --home "$HOME/.bytedesk-gateway" \
  --bind 127.0.0.1:18443 --profile core|agents|desktop [--start]
```

Default is private bind. See `references/profiles.md` under desktop-deps for deps.

## After install

1. Run **gateway-lifecycle** `setup-url.sh` / open `/setup?token=…`
2. Run **gateway-doctor**
3. Optional: **desktop-deps**, **pam-setup**, **vault-install**
