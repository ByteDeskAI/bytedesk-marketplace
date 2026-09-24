---
name: pam-setup
description: >
  Guide PAM authentication setup for the gateway. Linux-focused; documents
  AUTH_MODE=local alternatives on macOS and Windows.
---

# pam-setup

```bash
ROOT="${GROK_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
SKILL_DIR="${ROOT:+$ROOT/skills/pam-setup}"
SKILL_DIR="${SKILL_DIR:-<directory containing this SKILL.md>}"
```

```bash
"$SKILL_DIR/scripts/setup-pam.sh"
```

Does not write `/etc/pam.d` without operator sudo. Prefer local TOTP on non-Linux.
