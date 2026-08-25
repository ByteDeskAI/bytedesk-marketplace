# plugin-rsync

Rsync ByteDesk marketplace plugin **source** into the **installed caches** Claude, Grok, and Codex actually load. Directory-source marketplaces run live from git; hashed caches do not, and `/plugin update` is silent when a plugin is unpinned. This copies the tree you just edited into those caches.

**User-scope only.** Install with `/plugin install plugin-rsync@bytedesk` at user scope. Do not add it to a project's `extraKnownMarketplaces` or `enabledPlugins`.

## Usage

```bash
plugin-rsync                         # every installed bytedesk marketplace plugin
plugin-rsync task-management         # one
plugin-rsync task-management,fleet   # several (commas; spaces also work)
plugin-rsync --list
plugin-rsync --dry-run task-management
```

Source is `BYTEDESK_MARKETPLACE`, or the marketplace checkout next to this plugin, or the `bytedesk` directory marketplace in `~/.claude/plugins/known_marketplaces.json`.

Destinations (existing installs only — this never creates a new plugin install):

| Host | Where |
|---|---|
| Claude | `~/.claude/plugins/cache/bytedesk/<name>/<sha>/` |
| Codex | `~/.codex/plugins/cache/bytedesk/<name>/` (and sha dirs) |
| Grok | `~/.grok/installed-plugins/<id>/` (plus `<name>/` when the install is a marketplace copy) |

`node_modules`, `.git`, and Vite leftovers are excluded. `--delete` drops dest-only files except those excludes.

## PATH

```bash
./install.sh                 # ~/.local/bin/plugin-rsync
./install.sh --uninstall
```

## Tests

```bash
bash plugin-rsync/tests/test-plugin-rsync.sh
```
