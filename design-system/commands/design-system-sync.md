---
description: Vendor the ByteDesk design system (tokens + this repo's own profile) into the repository
argument-hint: "[--app <slug>] [--dir <path>] [--check]"
---

# Design System Sync

Vendor the family design system into this repository as plain committed files.

Run it from the repository root:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/design-system-sync.mjs $ARGUMENTS
```

Argument handling:

- `--app <slug>` — the product whose profile this repo vendors. Required the
  first time. Afterwards it is remembered in `.context/design-system/.design-system.json`
  and may be omitted. If `$ARGUMENTS` has no `--app` and no state file exists,
  do **not** guess: run the script once with no arguments, show the user the
  "known apps" list it prints, and ask which one this repository is.
- `--dir <path>` — vendor destination, default `.context/design-system`.
- `--check` — drift gate. Writes nothing; exits 1 when the vendored
  `.source-sha` differs from the plugin payload's. This is what CI runs.

What a sync writes into `<dir>`:

- `tokens/css/bytedesk.css` and `tokens/tailwind/theme.css` — the canonical
  `--bd-*` layer and its Tailwind v4 adapter.
- `profiles/<app>/` — **only this repository's own profile.** Never another
  app's; a repo that vendors a sibling's profile is a bug, not a convenience.
- `.source-sha` — the design-system commit this payload was published from.
- `README.md` — the do-not-edit stamp.
- `.design-system.json` — the remembered app slug.

It also appends `export IMPECCABLE_CONTEXT_DIR=<dir>/profiles/<app>` to `.envrc`
when that line is absent. The operation is idempotent: re-running rewrites the
same bytes and duplicates nothing.

After the first sync in a repository, tell the user to commit the vendored tree
(it is build input — CI and `next build` read it, and neither has a plugin
layer) and, if `globals.css` still imports tokens from a submodule mount, to
point those imports at the vendored path.

The payload is embedded in the plugin, so this needs no network access and no
credentials for the private `ByteDeskAI/design-system` repository.

Never edit files under `<dir>` to change a token or a profile. Authoring lives
upstream in `ByteDeskAI/design-system`; `node scripts/publish-plugin.mjs` there
refreshes this plugin's payload; consumers then re-sync.
