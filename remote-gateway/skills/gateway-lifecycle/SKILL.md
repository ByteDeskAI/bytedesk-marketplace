---
name: gateway-lifecycle
description: >
  Start, stop, status, healthz, and print /setup URL for an installed ByteDesk
  gateway on Linux (systemd), macOS (launchd), or Windows (run.ps1/pid).
---

# gateway-lifecycle

```bash
SKILL_DIR="<setup/skills/gateway-lifecycle>"
# Linux / macOS / Git Bash:
"$SKILL_DIR/scripts/start.sh"
"$SKILL_DIR/scripts/stop.sh"
"$SKILL_DIR/scripts/status.sh"
"$SKILL_DIR/scripts/health.sh"
"$SKILL_DIR/scripts/setup-url.sh"
```

```powershell
# Windows PowerShell / pwsh:
$SKILL_DIR = "<setup/skills/gateway-lifecycle>"
pwsh -File "$SKILL_DIR/scripts/start.ps1"
pwsh -File "$SKILL_DIR/scripts/stop.ps1"
pwsh -File "$SKILL_DIR/scripts/status.ps1"
pwsh -File "$SKILL_DIR/scripts/health.ps1"
pwsh -File "$SKILL_DIR/scripts/setup-url.ps1"
```

| OS | Service backend |
|----|-----------------|
| Linux | `systemctl --user` when available, else `run.sh` + pid |
| macOS | launchd LaunchAgent `ai.bytedesk.gateway` |
| Windows | `run.ps1` / binary + `gateway.pid` |

Home resolution: `BYTEDESK_GATEWAY_HOME` / `GATEWAY_HOME` / `~/.bytedesk-gateway` / `~/.bytedesk-emote-gateway`.
