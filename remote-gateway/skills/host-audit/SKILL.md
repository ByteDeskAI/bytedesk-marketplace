---
name: host-audit
description: >
  Read-only host inventory and EAGAIN/task diagnostics for gateway hosts on
  Linux, macOS, and Windows. Use for audit, screen/desktop health context, cleanup ranking.
---

# host-audit

```bash
ROOT="${GROK_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
SKILL_DIR="${ROOT:+$ROOT/skills/host-audit}"
SKILL_DIR="${SKILL_DIR:-<directory containing this SKILL.md>}"
```

```bash
"$SKILL_DIR/scripts/host-diagnostics.sh" inventory
"$SKILL_DIR/scripts/host-diagnostics.sh" eagain
# Windows: pwsh -File "$SKILL_DIR/scripts/host-diagnostics.ps1" inventory
```

Read-only first. No machine-hardcoded paths. Do not stop services without a ranked plan and operator OK.
