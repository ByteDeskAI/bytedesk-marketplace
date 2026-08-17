# design-system

Delivers the ByteDesk design system into any repository as **plain committed
files**. The plugin carries the payload; a sync copies it into the repo tree.

## Why vendored files, not a submodule

A plugin is machine-local. A build is not. `next build`, `go:embed`, and above
all TeamCity have no plugin layer — none of them can read from a plugin cache.
So the plugin never *is* the design system in a repository; it **delivers** the
design system into the repository, and the repository commits what it received.

That also kills the private-repo gate: because the payload is embedded in the
plugin, a sync needs no network access and no PAT for the private
`ByteDeskAI/design-system` repository. CI just builds committed files.

## The two commands

### `/design-system-sync`

Vendors into an existing repository.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/design-system-sync.mjs --app gateway
```

| flag | meaning |
| --- | --- |
| `--app <slug>` | the product whose profile this repo vendors; remembered after the first run |
| `--dir <path>` | destination, default `.context/design-system` |
| `--check` | drift gate — writes nothing, exits 1 when the vendored SHA differs |

### `/design-system-scaffold`

Creates a **new** site already wrapped in the system, via `scaffold/create.mjs`
in a checkout of `ByteDeskAI/design-system` (the starter templates live there).
See `skills/design-system-scaffold/SKILL.md`.

## The vendored contract

A sync writes exactly this into `<dir>`:

```text
.context/design-system/
├── tokens/css/bytedesk.css        the canonical --bd-* layer
├── tokens/tailwind/theme.css      the Tailwind v4 adapter
├── profiles/<app>/                THIS app's profile only — DESIGN.md, PRODUCT.md
├── .source-sha                    the design-system commit this came from
├── .design-system.json            { "app": "<slug>" }
└── README.md                      the do-not-edit stamp
```

and appends `export IMPECCABLE_CONTEXT_DIR=<dir>/profiles/<app>` to `.envrc` if
that line is absent.

Rules the contract enforces:

- **One repository vendors one profile — its own.** Never a sibling product's.
- **The vendored tree is read-only.** It is build input, not source.
- **The sync is idempotent.** Re-running rewrites the same bytes.
- The vendored tree is **committed**. That is the whole point.

## Authoring lives upstream

```text
ByteDeskAI/design-system          author tokens + profiles, commit
  └─ node scripts/publish-plugin.mjs
       └─ this plugin's payload/ + payload/.source-sha    commit + push
            └─ consumer: /design-system-sync              commit the vendored tree
```

Never edit `payload/` by hand and never edit a consumer's vendored tree. A token
or profile change lands upstream, is published, and arrives on the next sync.

## CI drift gate

A submodule pin is enforced by git; a vendored directory is not. So CI runs the
check instead:

```bash
node <plugin>/scripts/design-system-sync.mjs --check
```

Exit 1 means the repository is vendoring an older design-system commit than the
plugin publishes — re-sync and commit.

## SessionStart hook

`hooks/session-start-sync.sh` vendors automatically, but only for a repository
that is **already configured** and whose vendored tree is missing — a fresh
clone, or a cleaned `.context/`. It reads the app from `.design-system.json` or
from `.envrc`'s `IMPECCABLE_CONTEXT_DIR`. If neither names an app, it exits
silently: the hook never guesses an app and never mutates an unconfigured
repository. Refreshing an already-vendored tree stays an explicit
`/design-system-sync`.

## Versioning

This plugin carries no `version` field, so Claude Code resolves its version to
the marketplace commit SHA and consumers update on every commit. The
`.source-sha` in the payload — not a plugin version — is what identifies the
design-system content being delivered.
