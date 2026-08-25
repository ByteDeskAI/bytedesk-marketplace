---
description: Install, preview, verify, or diagnose the ByteDesk design system in this repository
argument-hint: "[--app <slug>] [--dir <path>] [--dry-run | --check | --doctor]"
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
- `--dry-run` — print the exact add/change/delete plan without writing.
- `--check` — integrity gate. Writes nothing; verifies the source revision,
  selected profile, every managed checksum, missing files, stale files, and
  unexpected files. This is what CI runs.
- `--doctor` — run the integrity gate plus actionable checks for runtime token
  wiring, the local `DESIGN.md` adapter, `AGENTS.md`, and CI.

What a sync writes into `<dir>`:

- `DESIGN.md` — the shared ByteDesk foundation.
- `tokens/bytedesk.tokens.json`, `tokens/css/bytedesk.css`, and
  `tokens/tailwind/theme.css` — canonical values and runtime adapters.
- `profiles/<app>/` — **only this repository's own profile.** Never another
  app's; a repo that vendors a sibling's profile is a bug, not a convenience.
- `.source-sha` — the design-system commit this payload was published from.
- `.managed-files.json` — the expected files, checksums, and sizes.
- `README.md` — the do-not-edit stamp.
- `.design-system.json` — the remembered app slug.

It also appends `export IMPECCABLE_CONTEXT_DIR=<dir>/profiles/<app>` to `.envrc`
when that line is absent. Replacement is atomic and removes files deleted
upstream. Re-running a healthy sync reports `NO CHANGES` and writes nothing.

After the first sync in a repository, tell the user to commit the vendored tree
(it is build input — CI and `next build` read it, and neither has a plugin
layer) and, if `globals.css` still imports tokens from a submodule mount, to
point those imports at the vendored path.

Exit codes are stable for automation: `0` healthy, `1` managed-content drift,
`2` consumer misconfiguration, and `3` tool or payload failure.

The payload is embedded in the plugin, so this needs no network access and no
credentials for the private `ByteDeskAI/design-system` repository.

Never edit files under `<dir>` to change a token or a profile. Authoring lives
upstream in `ByteDeskAI/design-system`; `node scripts/publish-plugin.mjs` there
refreshes this plugin's payload; consumers then re-sync.
