---
name: design-system-profile
description: Create or revise a ByteDesk product design profile in the canonical design-system repository, preserving shared-versus-product authority, catalog metadata, inheritance, and review gates. Use for governed product design instructions, not consumer-only exceptions.
---

# Design System Profile

Work only in a `ByteDeskAI/design-system` authoring checkout. A managed consumer
copy is read-only.

1. Read root `AGENTS.md`, shared `DESIGN.md`, `catalog.json`,
   `profiles/README.md`, and the closest existing profile or `_template`.
2. Decide whether the requested rule is family-wide, product-specific, or a
   consumer-local exception. Put only product identity, visual language,
   implementation contract, and explicitly scoped exceptions in the profile.
3. Author `profiles/<slug>/DESIGN.md` and `PRODUCT.md` only when product metadata
   is useful. Link to shared tokens instead of copying their values.
4. Add or update the catalog entry with immutable source provenance and the
   narrowest accurate status. Call out breaking guidance in `CHANGELOG.md`.
5. Run `node scripts/validate.mjs` and `node --test tests/*.test.mjs`, inspect the
   diff, and describe which consumers must sync.

Never infer canonical rules from a screenshot or deployed consumer alone.
