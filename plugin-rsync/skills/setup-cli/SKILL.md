---
name: setup-cli
description: Put plugin-rsync on the user's PATH (~/.local/bin). Use after installing plugin-rsync@bytedesk at user scope, or when plugin-rsync is command not found.
user-invokable: true
allowed-tools:
  - Bash
---

```
plugin-rsync install-cli
```

This writes a wrapper into `~/.local/bin`. It will not overwrite a file it did not write.

This plugin is **user-scope only**. Do not register it in a project's `.claude/settings.json`.
