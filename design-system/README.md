# design-system

Delivers the ByteDesk design system into any repository as **plain committed
files**. The plugin carries the payload; a sync copies it into the repo tree.

Install the same `1.5.0` bundle in either provider:

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

The provider-portable `design-system-agents` skill adds one governed router, for
31 total skills. Claude also discovers four native specialists:
`profile-architect`, `token-accessibility-auditor`,
`consumer-migration-specialist`, and `design-system-reviewer`. Codex executes
the same canonical role contracts through the routing skill because its plugin
manifest cannot register custom agents. Read-only roles expose no mutating
tools; migration requires an explicit request and reviewed dry-run before apply.

### Read-only MCP

Claude and Codex register the same offline stdio server automatically. It exposes
five deterministic tools: `list_design_items`, `search_design_system`,
`get_design_item`, `explain_rule`, and `audit_repository`. Agents can discover
the full design-kit graph, resolve shared/profile/consumer authority with source
citations, and audit a repository without writing to it or calling the network.

### One-command adoption

Run the executable from the installed plugin at the root of an existing
repository. It detects the runtime and exact product identity when unambiguous;
use flags when either choice needs to be explicit.

```bash
node ${CLAUDE_PLUGIN_ROOT}/bin/bd-design list
node ${CLAUDE_PLUGIN_ROOT}/bin/bd-design inspect profile:gateway
node ${CLAUDE_PLUGIN_ROOT}/bin/bd-design init --app gateway
```

The command vendors the profile, wires web tokens or a Go/native adapter,
maintains marked sections in `DESIGN.md` and `AGENTS.md`, installs a standalone
CI drift gate, verifies the result, and prints `git status` plus a diff summary.
Preview without writing via `--dry-run`. The same CLI exposes `sync`, `check`,
`doctor`, and `migrate`, so developers never need to locate internal scripts.

Legacy adoption is deliberately two-step:

```bash
node ${CLAUDE_PLUGIN_ROOT}/bin/bd-design migrate --app gateway
node ${CLAUDE_PLUGIN_ROOT}/bin/bd-design migrate --app gateway --apply
```

Migration removes only a verified clean submodule or manual snapshot. A dirty
legacy tree is a hard stop so local work cannot be discarded.

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

Creates a **new** site already wrapped in the system via the plugin-embedded
`scaffold/create.mjs`, then hands off to the same init executable. No source
checkout, private-repository token, or submodule is required. See
`skills/design-system-scaffold/SKILL.md`.

## The vendored contract

A sync writes exactly this into `<dir>`:

```text
.context/design-system/
├── DESIGN.md                       the shared ByteDesk foundation
├── tokens/bytedesk.tokens.json     canonical DTCG-style values
├── tokens/css/bytedesk.css         the canonical --bd-* layer
├── tokens/tailwind/theme.css       the Tailwind v4 adapter
├── tokens/platforms/               generated TypeScript, Go, and Rust adapters
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
node .bytedesk/design-system-check.mjs
```

The check verifies source revision, selected profile, missing or corrupted
files, stale records, and unexpected files. Because the checker is committed in
the consumer, CI does not need the plugin installed. Exit codes are stable: `0`
healthy, `1` managed-content drift, and `2` consumer or tool configuration
failure. Run sync with `--doctor` for exact fixes to token imports, design
inheritance, agent instructions, or the CI drift gate.

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
