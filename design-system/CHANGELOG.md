# Changelog

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
