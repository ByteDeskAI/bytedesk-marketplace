---
name: tunnel-funnel
description: >
  Optional public exposure guidance and health probes for Funnel/tunnels on
  Linux, macOS, and Windows. Private-first remains default.
---

# tunnel-funnel

```bash
SKILL_DIR="<setup/skills/tunnel-funnel>"
```

```bash
PUBLIC_PROBE_URL=https://example/healthz "$SKILL_DIR/scripts/probe-public.sh"
# or: "$SKILL_DIR/scripts/probe-public.sh" https://example/healthz
```

Load `references/exposure.md`. Never force public exposure.
