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
plugin-rsync --json task-management            # copy, then report what changed as JSON
plugin-rsync --json --dry-run task-management  # preview (rsync -n); copies nothing
```

`--json` reports, per plugin, every cache refreshed (`host`, `path`, `changed`) and each changed
path classified as `live` (runs fresh: `bin/` CLIs and the code they load), `needs-reload` (`hooks/`,
`skills/`, `commands/`, `agents/`, `monitors/`, plugin manifests, `.mcp.json`/`.codex-mcp.json`, every
file a long-running process starts from — the MCP server entry and each `monitors/monitors.json`
command, such as `bin/tm-dashboard` — and `lib/`/`src/`/`dist/` when the plugin declares an MCP
server or a monitor), or a
`skipped` cache entry for a host with no install. `reloads_required` lists, per host, the plugins
that need a session reload. It is a report only; it never reloads anything. Default output is
unchanged. The full rule is in `plugin-rsync --help`.

Source is `BYTEDESK_MARKETPLACE`, or the marketplace checkout next to this plugin, or the `bytedesk` directory marketplace in `~/.claude/plugins/known_marketplaces.json`.

Destinations (existing installs only — this never creates a new plugin install):

| Host | Where |
|---|---|
| Claude | `~/.claude/plugins/cache/bytedesk/<name>/<sha>/` |
| Codex | `~/.codex/plugins/cache/bytedesk/<name>/` (and sha dirs) |
| Grok | `~/.grok/installed-plugins/<id>/` (plus `<name>/` when the install is a marketplace copy) |

`node_modules`, `.git`, and Vite leftovers are excluded. `--delete` drops dest-only files except those excludes.

## Automatic sync

Installed in Claude, Codex or Grok, this plugin's SessionStart hook sets
`core.hooksPath=scripts/git-hooks` in a bytedesk-marketplace checkout where it is unset. After
that, every commit, merge or rebase in the main checkout rsyncs the plugins it touched (log:
`.git/plugin-rsync.log`). After a Codex sync, `trust-codex-hooks` records the new hook hashes
as trusted so Codex runs them without asking.

The same hook keeps each machine current. In the background, at most every 10 minutes, it
fast-forwards the machine's marketplace checkout (the one Claude registered, or the repo the
session starts in) from `origin/main`; the post-merge hook then syncs what the pull changed. Only a
main checkout on `main` that is behind origin moves; local commits and other branches are left alone.
A machine that has never pulled this change needs one manual `git pull` to start.

On a machine that only runs Codex, nothing is trusted at first, so the hook cannot trust itself.
The plugin's MCP server (no tools) does it instead: Codex starts it without approval, and its start
runs `trust-codex-hooks`. The first Codex session trusts the hooks; the session hook runs from the
second.

## PATH

```bash
./install.sh                 # ~/.local/bin/plugin-rsync
./install.sh --uninstall
```

## Local skill symlinks

Grok's slash menu reads **`~/.grok/skills`**, not only `~/.agents/skills`. Claude reads `~/.claude/skills`. Codex reads `~/.codex/skills`. Point all four at `plugin-rsync/skills/plugin-rsync`:

```bash
src=../../Documents/GitHub/ByteDeskAI/bytedesk-marketplace/plugin-rsync/skills/plugin-rsync
ln -sfn "$src" ~/.grok/skills/plugin-rsync
ln -sfn "$src" ~/.claude/skills/plugin-rsync
ln -sfn "$src" ~/.codex/skills/plugin-rsync
ln -sfn "$src" ~/.agents/skills/plugin-rsync
```

Open a new session after linking. The plugin skill used to live in `skills/sync`, which advertised as `/plugin-rsync:sync` rather than `/plugin-rsync`.

## Tests

```bash
bash plugin-rsync/tests/test-plugin-rsync.sh
```
