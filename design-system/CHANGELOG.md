# Changelog

## [1.4.0] — 2026-08-25

### Added

- Added four native Claude specialist agents for profile architecture,
  token/accessibility auditing, preview-first migration, and design-system
  review.
- Added the `design-system-agents` Codex fallback skill, machine-readable agent
  catalog, and golden routing, safety, and output-contract tests.
- Published from immutable design-system source revision `f96b2fb`.

## [1.3.0] — 2026-08-25

### Added

- Added an offline, read-only MCP server with deterministic tools for inventory,
  search, item inspection, rule-authority explanation, and consumer audits.
- Added matching automatic Claude and Codex MCP registrations.
- Published generated TypeScript, Go, and Rust token adapters and the expanded
  Gateway client design contract from source revision `9ac0482`.

## [1.2.0] — 2026-08-25

### Added

- Added the schema-validated `design-system.manifest.json` capability graph,
  inventorying every distributable file, token, adapter, profile, asset,
  template, skill, agent, MCP server, bundle, dependency, provider, and runtime.
- Added the zero-dependency `bin/bd-design` CLI with `list`, `inspect`, `init`,
  `migrate`, `sync`, `check`, and `doctor` commands.
- Publication, managed sync, and validation now resolve their file sets from the
  same manifest and reject stale checksums, broken dependencies, and uncataloged
  distributable files.

## [1.1.1] — 2026-08-25

### Fixed

- Normalized published text before calculating byte-level manifests, making the
  plugin artifact and its integrity validation deterministic across Windows and
  Unix checkouts.

## [1.1.0] — 2026-08-25

### Added

- Added a true one-command `design-system-init` executable that detects the
  consumer runtime and product, vendors the checksummed payload, wires design
  inheritance, agent instructions, runtime adapters, and a CI drift gate, then
  prints a ready-to-review adoption diff. (TM-004)
- Added explicit, preview-first migration for clean legacy submodules and manual
  snapshots, preserving consumer-local prose and refusing dirty legacy trees.
- Added a standalone consumer drift checker so CI never depends on a local
  plugin cache.
- Embedded the scaffold and consumer templates in the plugin for offline,
  source-checkout-free adoption.

## [1.0.1] — 2026-08-25

### Fixed

- Removed legacy Claude command shims that duplicated the provider-native sync
  and scaffold skills in discovery. Both providers now expose exactly 30 unique
  skills. (TM-003)

## [1.0.0] — 2026-08-25

### Added

- Matching Claude and Codex plugin manifests and marketplace discovery.
- Ten ByteDesk workflows for init, sync, doctor, audit, profiles, tokens,
  assets, migration, release, and scaffolding.
- Twenty reviewed design skills with immutable source provenance, bundled MIT
  licenses, and file-level checksums.
- Versioned, offline consumer payload with immutable source SHA and validation.

### Build

- Zero-dependency plugin validator and marketplace CI gate. (TM-003)
