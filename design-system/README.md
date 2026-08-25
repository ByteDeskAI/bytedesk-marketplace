# design-system

Delivers the ByteDesk design system into any repository as **plain committed
files**. The plugin carries the payload; a sync copies it into the repo tree.

Install the same `1.0.0` bundle in either provider:

```bash
# Claude Code
claude plugin marketplace add ByteDeskAI/bytedesk-marketplace
claude plugin install design-system@bytedesk

# Codex
codex plugin marketplace add ByteDeskAI/bytedesk-marketplace --ref main
codex plugin add design-system@bytedesk
```

## Why vendored files, not a submodule

A plugin is machine-local. A build is not. `next build`, `go:embed`, and above
all TeamCity have no plugin layer — none of them can read from a plugin cache.
So the plugin never *is* the design system in a repository; it **delivers** the
design system into the repository, and the repository commits what it received.

That also kills the private-repo gate: because the payload is embedded in the
plugin, a sync needs no network access and no PAT for the private
`ByteDeskAI/design-system` repository. CI just builds committed files.

## Core workflows

The plugin includes ten ByteDesk workflows: init, sync, doctor, audit, profile,
tokens, assets, migration, release, and scaffold. It also includes twenty
reviewed design-craft skills. Provider installation makes all 30 discoverable;
the consuming repository does not need its own `.agents/skills` copy.

### `/design-system-sync`

Vendors into an existing repository.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/design-system-sync.mjs --app gateway
```

| flag | meaning |
| --- | --- |
| `--app <slug>` | the product whose profile this repo vendors; remembered after the first run |
| `--dir <path>` | destination, default `.context/design-system` |
| `--dry-run` | exact add/change/delete plan; writes nothing |
| `--check` | checksum and profile integrity gate; writes nothing |
| `--doctor` | integrity plus actionable runtime, instruction, and CI wiring checks |

### `/design-system-scaffold`

Creates a **new** site already wrapped in the system, via `scaffold/create.mjs`
in a checkout of `ByteDeskAI/design-system` (the starter templates live there).
See `skills/design-system-scaffold/SKILL.md`.

## The vendored contract

A sync writes exactly this into `<dir>`:

```text
.context/design-system/
├── DESIGN.md                       the shared ByteDesk foundation
├── tokens/bytedesk.tokens.json     canonical DTCG-style values
├── tokens/css/bytedesk.css         the canonical --bd-* layer
├── tokens/tailwind/theme.css       the Tailwind v4 adapter
├── profiles/<app>/                THIS app's profile only — DESIGN.md, PRODUCT.md
├── .source-sha                     the design-system commit this came from
├── .design-system.json             remembered app and source revision
├── .managed-files.json             checksums and sizes for managed files
└── README.md                       the do-not-edit stamp
```

and appends `export IMPECCABLE_CONTEXT_DIR=<dir>/profiles/<app>` to `.envrc` if
that line is absent.

Rules the contract enforces:

- **One repository vendors one profile — its own.** Never a sibling product's.
- **The vendored tree is read-only.** It is build input, not source.
- **The sync is idempotent and atomic.** A healthy rerun writes nothing; an
  interrupted replacement restores the previous tree.
- **Deleted upstream files are removed.** Stale managed content cannot survive.
- The vendored tree is **committed**. That is the whole point.

## Authoring lives upstream

```text
ByteDeskAI/design-system          author tokens + profiles, commit
  └─ node scripts/publish-plugin.mjs
       └─ this plugin's runtime + checksummed payload     commit + push
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

The check verifies source revision, selected profile, missing or corrupted
files, stale records, and unexpected files. Exit codes are stable: `0` healthy,
`1` managed-content drift, `2` consumer misconfiguration, and `3` tool or
payload failure. Run `--doctor` during adoption to get exact fixes for missing
token imports, design inheritance, agent instructions, or the CI drift gate.

## SessionStart hook

`hooks/session-start-sync.sh` vendors automatically, but only for a repository
that is **already configured** and whose vendored tree is missing — a fresh
clone, or a cleaned `.context/`. It reads the app from `.design-system.json` or
from `.envrc`'s `IMPECCABLE_CONTEXT_DIR`. If neither names an app, it exits
silently: the hook never guesses an app and never mutates an unconfigured
repository. Refreshing an already-vendored tree stays an explicit
`/design-system-sync`.

## Versioning

The Claude and Codex manifests share one semantic version. The payload manifest
and skill provenance record both that version and the immutable source commit.
Plugin version identifies the capability bundle; `.source-sha` identifies the
exact design-system content delivered into a consumer.

Run the complete release check with:

```bash
node scripts/validate-plugin.mjs .
```
