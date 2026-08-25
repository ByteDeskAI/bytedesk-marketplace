---
name: plugin-rsync
description: Rsync ByteDesk marketplace plugin source into globally installed Claude, Grok, and Codex caches. Use when the user says rsync plugins, refresh the plugin cache, update installed plugins from source, or "sync task-management into grok/claude".
user-invokable: true
argument-hint: "[plugin[,plugin...]]"
allowed-tools:
  - Bash
---

# plugin-rsync

User-scope only. Do **not** add `plugin-rsync@bytedesk` to a project's `extraKnownMarketplaces` or `enabledPlugins`.

```bash
plugin-rsync $ARGUMENTS
```

If `plugin-rsync` is not on PATH, run it from the marketplace:

```bash
node <marketplace>/plugin-rsync/bin/plugin-rsync $ARGUMENTS
```

- No arguments → every **installed** bytedesk marketplace plugin.
- One name → that plugin (`plugin-rsync task-management`).
- Several → comma-separated (`plugin-rsync task-management,fleet`) or spaces.

`--list` prints destinations without copying. `--dry-run` prints the rsync argv.

Tell the user which caches were updated. If a named plugin is not in the marketplace or has no install, report that and stop.
