---
name: desktop-deps
description: >
  Check desktop/agents profile dependencies for the gateway on Linux, macOS, and
  Windows. Use when desktop profile, VNC, Xvfb, or ttyd is missing.
---

# desktop-deps

```bash
ROOT="${GROK_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
SKILL_DIR="${ROOT:+$ROOT/skills/desktop-deps}"
SKILL_DIR="${SKILL_DIR:-<directory containing this SKILL.md>}"
```

```bash
"$SKILL_DIR/scripts/check-deps.sh"
# Windows: pwsh -File "$SKILL_DIR/scripts/check-deps.ps1"
```

Load `references/profiles.md`. Desktop is first-class on Linux; best-effort on macOS/Windows.
