# Changelog

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
