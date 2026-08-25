---
name: design-system-assets
description: Import an approved ByteDesk brand or product asset into the canonical repository with ownership, provenance, checksum, catalog metadata, usage limits, and validation. Use for durable production assets, not drafts or third-party reference packs.
---

# Design System Assets

Work in `ByteDeskAI/design-system` and read `DESIGN.md`, `assets/README.md`,
`artifacts/README.md`, and the catalog schema before changing files.

1. Verify the asset is approved, ByteDesk-owned or appropriately licensed, and
   intended for production. Stop for missing ownership or identity approval.
2. Place organization-wide identity under `assets/brand/` and product identity
   under `assets/products/<product>/`. Use lowercase kebab-case and retain an
   editable vector master when available.
3. Add exactly one `catalog.json` entry per non-README file with source
   repository, path, immutable commit, SHA-256, media type, product, status, and
   precise usage constraints.
4. For a newly approved identity system, preserve its research, decisions,
   provenance, and approval evidence under `artifacts/` before promoting exports.
5. Inspect SVG safety and raster dimensions, then run the validator and tests.

Never treat file presence as permission to recolor, distort, or repurpose a mark.
