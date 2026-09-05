# Changelog

## [Unreleased]

### Added

- Restored checksum protection for all four specialist agents and CI golden routing
  scenarios from the pre-consolidation catalog. Added a manual prompt selector with
  explicit native-agent availability and a portable file-brief fallback (TM-099).

- Added the `task-management` profile (`DESIGN.md`, `PRODUCT.md`) and its
  `[data-bd-product="task-management"]` accent scope, which inherits the Gateway
  accent, and picked up the `designer-studio` profile already upstream with its
  platform-accent scope. Published from immutable design-system source revision
  `f652565`.

## [1.5.4] — 2026-08-31

Two payload republishes carried from upstream `design-system` main.

### Added

- Added the family generated-art contract section to every product profile, an
  `agent-mail` PRODUCT.md and product accent, four product accent rows in the token
  README, and a five-step guide for adding or changing a product accent. Published
  from immutable design-system source revision `ce8774b`.

### Changed

- Rewrote the Toolbox profile to state the split explicitly: JetBrains Toolbox is the
  functional reference only, and every visual value — colour, type, spacing, sizing,
  radius, border, elevation — comes from the ByteDesk token set, which is what sets row
  height and list density.
- The family gains a resting breathing-room floor of `space.6` to a containing edge and
  `space.5` between stacked elements, written as a floor rather than a value so density
  stays a per-profile decision. Published from immutable design-system source revision
  `dfaf002`.
- Moved two accents by the smallest amount that meets the contrast contract the token
  file had always asserted, hue and chroma held: `blue.500` oklch L 0.5910 → 0.5960
  (`#0079F2` → `#047BF4`) and `success` L 0.5698 → 0.5718 (`#009118` → `#029219`), with
  every alias — `interactive.blue`, `accent.default`, chart series 1 and 6,
  `product.gateway`, `product.store` — and the generated TypeScript, Rust, and Go
  adapters following. Published from immutable design-system source revision `ce8774b`.

### Fixed

- Added the missing `[data-bd-product]` scope for the four sites that inherit a
  product accent (`agent-browser-website`, `agent-memory-website`, `capture-website`,
  `bytedesk-ai`); without it `--bd-accent` fell back to brand orange. Corrected every
  contrast ratio in the token file to the value it actually measures — eight in the
  product group had drifted upward, and `text.secondary` claimed 10.8:1 while measuring
  7.77:1. Published from immutable design-system source revision `ce8774b`.

### Removed

- Dropped the `mockups/direction-v1` reference images and their READMEs from the
  published payload across all profiles, shrinking the distributed payload and both
  manifests. Published from immutable design-system source revision `dfaf002`.

## [1.5.3] — 2026-08-26

### Added

- Published the **Black Glass + Optical Layering** family visual language as a new
  `DESIGN.md` section — material, layering, energy, typography, geometry, and motion —
  together with its approved visual record (`README.md`, `DECISIONS.md`) under
  `artifacts/family/black-glass-optical-layering/`, which carries the measured material
  contract, the reference roles, and the open light-parity asset.
- Added `CONNECTIVITY.md` to the payload: the source → manifest → plugin → vendored
  consumer → CI lifecycle and per-layer ownership, delivered inside the payload so both
  sides read the same contract.
- Light is now a shipping family theme. `data-bd-theme="dark|light"` renders the exact
  semantic counterpart — identical architecture, geometry, and behavior, with only
  ground, translucency, shadow, highlight, and ink values changing.
- Added governed dark richness, `data-bd-richness="soft|balanced|rich"` (default
  `balanced`), which adjusts canvas depth, glass opacity, ambient shadow, and bloom
  only, and never layout, type, semantic color, focus, or minimum contrast.
- Added the material and depth tokens the language needs — `--bd-material-blur-*`,
  `--bd-material-shell-opacity`, `--bd-material-top-light`, `--bd-material-ambient-*`,
  `--bd-shadow-shell`, `--bd-shadow-focus-glow`, `--bd-shadow-attention-glow`, and the
  richness strengths — exposed them through the Tailwind theme, and regenerated the
  TypeScript, Rust, and Go adapters.
- Added `artifacts` as a first-class capability category in the manifest schema, in
  `bd-design list` / `inspect`, and in the MCP server's `list_design_items`.
- Added product identity assets: the Omnigent mark and wordmarks (including reverse),
  Agent Browser and Capture favicons, and the Workforce icon.

### Changed

- Retuned the dark neutral ramp — grounds, ink, and borders — to the material contract
  measured from the primary dark reference, and moved `product.toolbox` from `#7C8AE8`
  to `#4C7DFF`.
- Rewrote the Toolbox `DESIGN.md` and `PRODUCT.md` against the new family language, and
  renumbered the shared `DESIGN.md` sections 4–9 around the inserted visual-language
  section.
- Published from immutable design-system source revision `43248f3`.

## [1.5.2] — 2026-08-25

### Fixed

- Generated CI drift workflows now target the consumer's tracked default
  branch, supporting both `main` and `develop` repositories idempotently.
- Published from immutable design-system source revision `3c92040`.

## [1.5.1] — 2026-08-25

### Fixed

- Package-free static websites can adopt through an explicit web runtime and
  stylesheet without adding a root Node project.
- Doctor uses the recorded consumer runtime when checking nonstandard layouts.
- Published from immutable design-system source revision `ccb8d5d`.

## [1.5.0] — 2026-08-25

### Added

- Added the canonical `agent-memory-website` profile for the Agent Memory
  marketing site.
- Published from immutable design-system source revision `7e545e4`.

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
