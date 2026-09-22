---
name: gateway-doctor
description: >
  Diagnose a ByteDesk gateway install without printing secrets. Use for doctor,
  health check, missing control.env, or post-install verification.
---

# gateway-doctor

```bash
SKILL_DIR="<setup/skills/gateway-doctor>"
"$SKILL_DIR/scripts/doctor.sh"
# Windows: pwsh -File "$SKILL_DIR/scripts/doctor.ps1"
```

Reports presence of keys, healthz, and deps. Never dumps token values.
