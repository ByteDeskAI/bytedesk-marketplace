---
name: pam-setup
description: >
  Guide PAM authentication setup for the gateway. Linux-focused; documents
  AUTH_MODE=local alternatives on macOS and Windows.
---

# pam-setup

```bash
SKILL_DIR="<setup/skills/pam-setup>"
```

```bash
"$SKILL_DIR/scripts/setup-pam.sh"
```

Does not write `/etc/pam.d` without operator sudo. Prefer local TOTP on non-Linux.
