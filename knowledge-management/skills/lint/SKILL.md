---
name: knowledge-lint
description: >
  Health-check the OKF knowledge bundle — orphans, broken links, stale concepts,
  doctor repairs. Use for /knowledge:lint, "is the wiki healthy", or before a release.
user-invokable: true
allowed-tools: Bash, Read
---

# Lint knowledge

```bash
km lint
km doctor
km doctor --fix   # rebuild index, fill empty descriptions from titles
km validate
```

Report counts and the highest-severity issues. Fix broken links and stale_after in concepts when the user wants cleanup; do not mass-delete orphans without confirmation.
